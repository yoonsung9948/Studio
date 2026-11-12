package characters

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	imageinput "nori/studio/server/internal/domain/image"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/apperr"
)

func (s *Service) normalizeGeneration(in GenerateInput) (GenerateInput, error) {
	if len(in.Views) == 0 {
		in.Views = []string{"front"}
	}
	if len(in.Views) > len(views) {
		return in, invalid("too many character views")
	}
	seen := map[string]bool{}
	for _, view := range in.Views {
		if !validView(view) || seen[view] {
			return in, invalid("choose unique supported character views")
		}
		seen[view] = true
	}
	in.Views = slices.Clone(in.Views)
	slices.Sort(in.Views)
	if in.Count == 0 {
		in.Count = 1
	}
	if in.Count < 1 || in.Count > 4 {
		return in, invalid("count must be between 1 and 4 per view")
	}
	in.Prompt = strings.TrimSpace(in.Prompt)
	if !utf8.ValidString(in.Prompt) || utf8.RuneCountInString(in.Prompt) > 2000 {
		return in, invalid("prompt must contain at most 2000 UTF-8 characters")
	}
	raw, err := json.Marshal(imageinput.Input{Prompt: "Validate image settings", Model: in.Model, Settings: in.Settings, References: in.References})
	if err != nil {
		return in, err
	}
	raw, err = s.image.Canonicalize(raw)
	if err != nil {
		return in, invalid(err.Error())
	}
	var normalized imageinput.Input
	if err := json.Unmarshal(raw, &normalized); err != nil {
		return in, err
	}
	in.Model, in.Settings, in.References = normalized.Model, normalized.Settings, normalized.References
	return in, nil
}

// The canonical identity is always the selected front version of this character.
func identity(ctx context.Context, tx pgx.Tx, owner, id string, revision int) (string, string, error) {
	var versionID, assetID string
	err := tx.QueryRow(ctx, `SELECT v.id::text,v.asset_id::text FROM character_views cv
 JOIN character_image_versions v ON v.id=cv.selected_version_id AND v.character_id=cv.character_id AND v.owner_user_id=cv.owner_user_id
 WHERE cv.character_id=$1 AND cv.owner_user_id=$2 AND cv.view='front' AND v.approval='approved' AND v.appearance_revision=$3`, id, owner, revision).Scan(&versionID, &assetID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", conflict("identity_required", "Select a current front identity before generating or selecting additional views.")
	}
	return versionID, assetID, err
}

var viewInstructions = map[string]string{
	"front":         "Front portrait, facing the camera with neutral lighting.",
	"three_quarter": "Three-quarter portrait of the same person.",
	"profile":       "Left profile portrait of the same person.",
	"right_profile": "Right profile portrait of the same person.",
	"full_body":     "Full-body view of the same person.",
	"back":          "Back view of the same person.",
}

func generationPrompt(appearance, view, instructions string) string {
	if appearance == "" {
		appearance = "Use the selected identity reference as the source of appearance."
	}
	parts := []string{"Character appearance:\n" + appearance, viewInstructions[view], "Preserve facial identity, hairstyle, proportions, and defining features. Do not add text or a contact sheet."}
	if instructions != "" {
		parts = append(parts, "Additional direction:\n"+instructions)
	}
	return strings.Join(parts, "\n\n")
}

func (s *Service) Generate(ctx context.Context, owner, id, key string, in GenerateInput) (Generation, error) {
	if key == "" || len(key) > 200 || strings.TrimSpace(key) != key {
		return Generation{}, invalid("Idempotency-Key must contain 1-200 bytes without surrounding whitespace")
	}
	in, err := s.normalizeGeneration(in)
	if err != nil {
		return Generation{}, err
	}
	raw, err := json.Marshal(in)
	if err != nil {
		return Generation{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Generation{}, err
	}
	defer tx.Rollback(ctx)
	character, err := lockCharacter(ctx, tx, owner, id)
	if err != nil {
		return Generation{}, err
	}
	var batchID string
	var matches bool
	err = tx.QueryRow(ctx, `SELECT id::text,input_json=$4::jsonb FROM character_generation_batches WHERE character_id=$1 AND owner_user_id=$2 AND idempotency_key=$3`, id, owner, key, string(raw)).Scan(&batchID, &matches)
	if err == nil {
		if !matches {
			return Generation{}, engine.ErrIdempotencyConflict
		}
		result, err := generation(ctx, tx, owner, id, batchID)
		if err != nil {
			return Generation{}, err
		}
		return result, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Generation{}, err
	}
	if character.Appearance == "" && slices.Contains(in.Views, "front") {
		return Generation{}, invalid("Describe the character appearance before generating images.")
	}
	var identityID, identityAsset string
	for _, view := range in.Views {
		if view != "front" {
			identityID, identityAsset, err = identity(ctx, tx, owner, id, character.AppearanceRevision)
			if err != nil {
				return Generation{}, err
			}
			break
		}
	}
	sourceAsset := ""
	if in.SourceVersionID != "" {
		if len(in.Views) != 1 {
			return Generation{}, invalid("Editing requires exactly one view")
		}
		err := tx.QueryRow(ctx, `SELECT asset_id::text FROM character_image_versions WHERE id=$1 AND character_id=$2 AND owner_user_id=$3 AND view=$4 AND appearance_revision=$5`, in.SourceVersionID, id, owner, in.Views[0], character.AppearanceRevision).Scan(&sourceAsset)
		if errors.Is(err, pgx.ErrNoRows) {
			return Generation{}, apperr.ErrNotFound
		}
		if err != nil {
			return Generation{}, err
		}
	}
	batchID = uuid.NewString()
	result := Generation{ID: batchID, CharacterID: id, Jobs: []engine.Job{}}
	if err := tx.QueryRow(ctx, `INSERT INTO character_generation_batches(id,character_id,owner_user_id,idempotency_key,input_json) VALUES($1,$2,$3,$4,$5) RETURNING created_at`, batchID, id, owner, key, raw).Scan(&result.CreatedAt); err != nil {
		return Generation{}, err
	}
	for _, view := range in.Views {
		prompt := generationPrompt(character.Appearance, view, in.Prompt)
		refs := slices.Clone(in.References)
		var sourceIdentity *string
		if view != "front" {
			sourceIdentity = &identityID
			ref := imageinput.Reference{AssetID: identityAsset, Role: "identity"}
			if !slices.Contains(refs, ref) {
				refs = append(refs, ref)
			}
		}
		for candidate := 0; candidate < in.Count; candidate++ {
			input, err := json.Marshal(imageinput.Input{Prompt: prompt, Model: in.Model, Settings: in.Settings, References: refs, SourceAssetID: sourceAsset})
			if err != nil {
				return Generation{}, err
			}
			position := len(result.Jobs)
			job, err := s.jobs.SubmitTx(ctx, tx, owner, fmt.Sprintf("character:%s:%d", batchID, position), engine.Submission{Operation: func() string {
				if sourceAsset != "" {
					return "edit_image"
				}
				return s.image.Name()
			}(), Input: input})
			if err != nil {
				return Generation{}, err
			}
			_, err = tx.Exec(ctx, `INSERT INTO character_generations(job_id,batch_id,character_id,owner_user_id,position,view,appearance_revision,source_identity_version_id,prompt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, job.ID, batchID, id, owner, position, view, character.AppearanceRevision, sourceIdentity, prompt)
			if err != nil {
				return Generation{}, err
			}
			result.Jobs = append(result.Jobs, job)
		}
	}
	return result, tx.Commit(ctx)
}

func generation(ctx context.Context, tx pgx.Tx, owner, id, batchID string) (Generation, error) {
	result := Generation{ID: batchID, CharacterID: id, Jobs: []engine.Job{}}
	err := tx.QueryRow(ctx, `SELECT b.created_at FROM character_generation_batches b JOIN characters c ON c.id=b.character_id AND c.owner_user_id=b.owner_user_id WHERE b.id=$1 AND b.character_id=$2 AND b.owner_user_id=$3 AND c.deleted_at IS NULL`, batchID, id, owner).Scan(&result.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Generation{}, apperr.ErrNotFound
	}
	if err != nil {
		return Generation{}, err
	}
	rows, err := tx.Query(ctx, `SELECT j.id::text,j.project_id::text,j.operation,j.input_schema_version,j.input_json,j.status,j.created_at,j.updated_at FROM character_generations g JOIN jobs j ON j.id=g.job_id AND j.owner_user_id=g.owner_user_id WHERE g.batch_id=$1 AND g.character_id=$2 AND g.owner_user_id=$3 ORDER BY g.position`, batchID, id, owner)
	if err != nil {
		return Generation{}, err
	}
	result.Jobs, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (engine.Job, error) {
		var job engine.Job
		err := row.Scan(&job.ID, &job.ProjectID, &job.Operation, &job.InputSchemaVersion, &job.Input, &job.Status, &job.CreatedAt, &job.UpdatedAt)
		return job, err
	})
	return result, err
}

func (s *Service) Generation(ctx context.Context, owner, id, batchID string) (Generation, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Generation{}, err
	}
	defer tx.Rollback(ctx)
	result, err := generation(ctx, tx, owner, id, batchID)
	if err != nil {
		return Generation{}, err
	}
	return result, tx.Commit(ctx)
}
