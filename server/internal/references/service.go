package references

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	imageinput "nori/studio/server/internal/domain/image"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/production"
)

type Service struct {
	pool *pgxpool.Pool
	jobs *engine.JobService
}

func NewService(pool *pgxpool.Pool, jobs *engine.JobService) *Service { return &Service{pool, jobs} }
func invalid(s string) error                                          { return &apperr.ValidationError{Message: s} }
func table(kind string) string {
	switch kind {
	case "place":
		return "library_places"
	case "prop":
		return "library_props"
	}
	return ""
}

type Subject struct {
	IdentityReady bool              `json:"identityReady"`
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Description   string            `json:"description"`
	Notes         string            `json:"notes"`
	Revision      int               `json:"revision"`
	CreatedAt     time.Time         `json:"createdAt"`
	UpdatedAt     time.Time         `json:"updatedAt"`
	Views         map[string]string `json:"views"`
}
type Input struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Notes       string `json:"notes"`
}

func (s *Service) Create(ctx context.Context, owner, kind string, in Input) (Subject, error) {
	t := table(kind)
	if t == "" || strings.TrimSpace(in.Name) == "" || utf8.RuneCountInString(in.Name) > 100 || utf8.RuneCountInString(in.Description) > 10000 || utf8.RuneCountInString(in.Notes) > 10000 {
		return Subject{}, invalid("Invalid reference details")
	}
	id := uuid.NewString()
	_, err := s.pool.Exec(ctx, `INSERT INTO `+t+`(id,owner_user_id,name,description,notes) VALUES($1,$2,$3,$4,$5)`, id, owner, in.Name, in.Description, in.Notes)
	if err != nil {
		return Subject{}, err
	}
	return s.Get(ctx, owner, kind, id)
}
func load(ctx context.Context, tx pgx.Tx, owner, kind, id string) (Subject, string, string, error) {
	var item Subject
	var identityID, identityAsset string
	t := table(kind)
	var err error
	if t != "" {
		err = tx.QueryRow(ctx, `SELECT id::text,name,description,notes,revision,created_at,updated_at FROM `+t+` WHERE id::text=$1 AND owner_user_id=$2 AND deleted_at IS NULL FOR UPDATE`, id, owner).Scan(&item.ID, &item.Name, &item.Description, &item.Notes, &item.Revision, &item.CreatedAt, &item.UpdatedAt)
	} else if kind == "look" || kind == "cast" || kind == "place_instance" || kind == "prop_instance" {
		entity := map[string]string{"look": "looks", "cast": "characters", "place_instance": "locations", "prop_instance": "props"}[kind]
		var raw json.RawMessage
		var project string
		err = tx.QueryRow(ctx, `SELECT e.project_id::text FROM production_`+entity+` e JOIN projects p ON p.id=e.project_id AND p.owner_user_id=e.owner_user_id WHERE e.id=$1 AND e.owner_user_id=$2 AND e.deleted_at IS NULL AND p.deleted_at IS NULL FOR NO KEY UPDATE OF p`, id, owner).Scan(&project)
		if err == nil {
			err = tx.QueryRow(ctx, `SELECT data FROM production_`+entity+` WHERE id=$1 AND owner_user_id=$2 AND project_id=$3 AND deleted_at IS NULL FOR UPDATE`, id, owner, project).Scan(&raw)
		}
		if err == nil {
			var record production.Record
			_ = json.Unmarshal(raw, &record)
			description := record.Text("description") + "\n" + record.Text("styling")
			if kind == "cast" && record.Text("appearance") != "" {
				description = record.Text("appearance")
			}
			item = Subject{ID: id, Name: record.Text("name"), Description: description, Notes: record.Text("notes"), Revision: max(record.Number("revision"), 1)}
			identityRecord := record
			if kind == "look" {
				err = tx.QueryRow(ctx, `SELECT data FROM production_characters WHERE id=$1 AND project_id=$2 AND owner_user_id=$3 AND deleted_at IS NULL`, record.Text("characterId"), project, owner).Scan(&raw)
				if err == nil {
					_ = json.Unmarshal(raw, &identityRecord)
				}
			}
			if kind == "look" || kind == "cast" {
				identityID = identityRecord.Text("canonicalVersionId")
				if identityID != "" {
					err = tx.QueryRow(ctx, `SELECT m.asset_id::text FROM production_versions v JOIN production_media m ON m.id=v.data->>'assetId' AND m.project_id=v.project_id AND m.owner_user_id=v.owner_user_id WHERE v.id=$1 AND v.project_id=$2 AND v.owner_user_id=$3 AND v.revision=$4 AND v.data->>'approval'='approved'`, identityID, project, owner, max(identityRecord.Number("revision"), 1)).Scan(&identityAsset)
					if errors.Is(err, pgx.ErrNoRows) {
						identityID = ""
						identityAsset = ""
						err = nil
					}
				}
			}
		}

	} else {
		return item, "", "", invalid("Unsupported reference kind")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return item, "", "", apperr.ErrNotFound
	}
	return item, identityID, identityAsset, err
}
func (s *Service) Get(ctx context.Context, owner, kind, id string) (Subject, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Subject{}, err
	}
	defer tx.Rollback(ctx)
	item, _, identityAsset, err := load(ctx, tx, owner, kind, id)
	if err != nil {
		return item, err
	}
	item.IdentityReady = kind != "cast" || identityAsset != ""
	item.Views = map[string]string{}
	if table(kind) == "" {
		entity := map[string]string{"look": "looks", "cast": "characters", "place_instance": "locations", "prop_instance": "props"}[kind]
		var raw json.RawMessage
		if err := tx.QueryRow(ctx, `SELECT data FROM production_`+entity+` WHERE id=$1 AND owner_user_id=$2`, id, owner).Scan(&raw); err != nil {
			return item, err
		}
		var record production.Record
		_ = json.Unmarshal(raw, &record)
		field := "primaryVersionId"
		if kind == "cast" {
			field = "canonicalVersionId"
		}
		if record.Text(field) != "" {
			item.Views["front"] = record.Text(field)
		}
	}
	rows, err := tx.Query(ctx, `SELECT view,version_id::text FROM reference_selections WHERE owner_user_id=$1 AND kind=$2 AND subject_id=$3`, owner, kind, id)
	if err != nil {
		return item, err
	}
	for rows.Next() {
		var view, version string
		if err := rows.Scan(&view, &version); err != nil {
			rows.Close()
			return item, err
		}
		item.Views[view] = version
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return item, err
	}
	return item, tx.Commit(ctx)
}
func (s *Service) List(ctx context.Context, owner, kind, cursor string) ([]Subject, *string, error) {
	t := table(kind)
	if t == "" {
		return nil, nil, invalid("Unsupported reference kind")
	}
	rows, err := s.pool.Query(ctx, `SELECT id::text,name,description,notes,revision,created_at,updated_at FROM `+t+` WHERE owner_user_id=$1 AND deleted_at IS NULL AND id::text>$2 ORDER BY id::text LIMIT 101`, owner, cursor)
	if err != nil {
		return nil, nil, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Subject, error) {
		var item Subject
		err := row.Scan(&item.ID, &item.Name, &item.Description, &item.Notes, &item.Revision, &item.CreatedAt, &item.UpdatedAt)
		item.Views = map[string]string{}
		return item, err
	})
	if items == nil {
		items = []Subject{}
	}
	var next *string
	if len(items) > 100 {
		items = items[:100]
		last := items[99].ID
		next = &last
	}
	return items, next, err
}
func (s *Service) Update(ctx context.Context, owner, kind, id string, in Input) (Subject, error) {
	t := table(kind)
	if t == "" || strings.TrimSpace(in.Name) == "" || utf8.RuneCountInString(in.Name) > 100 || utf8.RuneCountInString(in.Description) > 10000 || utf8.RuneCountInString(in.Notes) > 10000 {
		return Subject{}, invalid("Invalid reference details")
	}
	tag, err := s.pool.Exec(ctx, `UPDATE `+t+` SET name=$3,description=$4,notes=$5,revision=revision+CASE WHEN description<>$4 THEN 1 ELSE 0 END,updated_at=now() WHERE id::text=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, id, owner, in.Name, in.Description, in.Notes)
	if err != nil {
		return Subject{}, err
	}
	if tag.RowsAffected() == 0 {
		return Subject{}, apperr.ErrNotFound
	}
	return s.Get(ctx, owner, kind, id)
}
func (s *Service) Delete(ctx context.Context, owner, kind, id string) error {
	t := table(kind)
	if t == "" {
		return invalid("Delete episode looks through the production")
	}
	tag, err := s.pool.Exec(ctx, `UPDATE `+t+` SET deleted_at=now() WHERE id::text=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, id, owner)
	if err == nil && tag.RowsAffected() == 0 {
		return apperr.ErrNotFound
	}
	return err
}

type Version struct {
	ID                string    `json:"id"`
	SubjectID         string    `json:"subjectId"`
	View              string    `json:"view"`
	AssetID           string    `json:"assetId"`
	ProducerJobID     *string   `json:"producerJobId"`
	Revision          int       `json:"revision"`
	IdentityVersionID *string   `json:"identityVersionId"`
	Approval          string    `json:"approval"`
	Stale             bool      `json:"stale"`
	CreatedAt         time.Time `json:"createdAt"`
}

func (s *Service) Versions(ctx context.Context, owner, kind, id, cursor string) ([]Version, *string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)
	subject, identity, _, err := load(ctx, tx, owner, kind, id)
	if err != nil {
		return nil, nil, err
	}
	rows, err := tx.Query(ctx, `SELECT id::text,subject_id,view,asset_id::text,producer_job_id::text,subject_revision,identity_version_id,approval,subject_revision<>$5 OR (NOT(kind='cast' AND view='front') AND identity_version_id IS DISTINCT FROM NULLIF($6,'')) OR (view<>'front' AND front_version_id IS DISTINCT FROM CASE WHEN kind='cast' THEN NULLIF($6,'') ELSE (SELECT s.version_id::text FROM reference_selections s WHERE s.owner_user_id=$1 AND s.kind=$2 AND s.subject_id=$3 AND s.view='front') END),created_at FROM reference_image_versions WHERE owner_user_id=$1 AND kind=$2 AND subject_id=$3 AND id::text>$4 ORDER BY id::text LIMIT 101`, owner, kind, id, cursor, subject.Revision, identity)
	if err != nil {
		return nil, nil, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Version, error) {
		var v Version
		err := row.Scan(&v.ID, &v.SubjectID, &v.View, &v.AssetID, &v.ProducerJobID, &v.Revision, &v.IdentityVersionID, &v.Approval, &v.Stale, &v.CreatedAt)
		return v, err
	})
	if err != nil {
		return nil, nil, err
	}
	if items == nil {
		items = []Version{}
	}
	var next *string
	if len(items) > 100 {
		items = items[:100]
		last := items[99].ID
		next = &last
	}
	return items, next, tx.Commit(ctx)
}
func (s *Service) Select(ctx context.Context, owner, kind, id, view, version string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	subject, identity, _, err := load(ctx, tx, owner, kind, id)
	if err != nil {
		return err
	}
	var exists bool
	err = tx.QueryRow(ctx, `SELECT true FROM reference_image_versions WHERE id=$1 AND owner_user_id=$2 AND kind=$3 AND subject_id=$4 AND view=$5`, version, owner, kind, id, view).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.ErrNotFound
	}
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE reference_image_versions SET approval='approved' WHERE id=$1 AND owner_user_id=$2 AND kind=$3 AND subject_id=$4 AND view=$5 AND subject_revision=$6 AND (($3='cast' AND $5='front') OR identity_version_id IS NOT DISTINCT FROM NULLIF($7,'')) AND ($5='front' OR front_version_id IS NOT DISTINCT FROM CASE WHEN $3='cast' THEN NULLIF($7,'') ELSE (SELECT s.version_id::text FROM reference_selections s WHERE s.owner_user_id=$2 AND s.kind=$3 AND s.subject_id=$4 AND s.view='front') END)`, version, owner, kind, id, view, subject.Revision, identity)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return invalid("Choose a current candidate for this view")
	}
	if _, err := tx.Exec(ctx, `INSERT INTO reference_selections(owner_user_id,kind,subject_id,view,version_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_user_id,kind,subject_id,view) DO UPDATE SET version_id=EXCLUDED.version_id`, owner, kind, id, view, version); err != nil {
		return err
	}
	if table(kind) == "" {
		entity := map[string]string{"look": "looks", "cast": "characters", "place_instance": "locations", "prop_instance": "props"}[kind]
		if entity == "" {
			return invalid("Unsupported reference kind")
		}
		if _, err := tx.Exec(ctx, `UPDATE production_versions SET data=jsonb_set(data,'{approval}','"approved"') WHERE id=$1 AND owner_user_id=$2`, version, owner); err != nil {
			return err
		}
		if view == "front" {
			field := "primaryVersionId"
			if kind == "cast" {
				field = "canonicalVersionId"
			}
			if _, err := tx.Exec(ctx, `UPDATE production_`+entity+` SET data=jsonb_set(jsonb_set(data,ARRAY[$3],to_jsonb($4::text)),'{savedViewIds}',COALESCE(data->'savedViewIds','{}')||jsonb_build_object($5::text,$4::text)) WHERE id=$1 AND owner_user_id=$2`, id, owner, field, version, view); err != nil {
				return err
			}
		} else if kind == "cast" {
			referenceID := "reference-" + id + "-" + view
			data, _ := json.Marshal(map[string]any{"id": referenceID, "characterId": id, "type": view, "activeVersionId": version})
			if _, err := tx.Exec(ctx, `INSERT INTO production_references(id,owner_user_id,project_id,parent_id,data) SELECT $1,owner_user_id,project_id,id,$4 FROM production_characters WHERE id=$2 AND owner_user_id=$3 ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data WHERE production_references.owner_user_id=$3`, referenceID, id, owner, data); err != nil {
				return err
			}
		} else {
			if _, err := tx.Exec(ctx, `UPDATE production_`+entity+` SET data=jsonb_set(data,'{savedViewIds}',COALESCE(data->'savedViewIds','{}')||jsonb_build_object($3::text,$4::text)) WHERE id=$1 AND owner_user_id=$2`, id, owner, view, version); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE projects p SET production_revision=production_revision+1,last_write_hash=NULL FROM production_`+entity+` e WHERE e.id=$1 AND e.owner_user_id=$2 AND p.id=e.project_id AND p.owner_user_id=e.owner_user_id`, id, owner); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func (s *Service) Reject(ctx context.Context, owner, kind, id, version string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, _, _, err := load(ctx, tx, owner, kind, id); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE reference_image_versions SET approval='rejected' WHERE id=$1 AND owner_user_id=$2 AND kind=$3 AND subject_id=$4`, version, owner, kind, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return apperr.ErrNotFound
	}
	if _, err := tx.Exec(ctx, `DELETE FROM reference_selections WHERE version_id=$1 AND owner_user_id=$2`, version, owner); err != nil {
		return err
	}
	if table(kind) == "" {
		entity := map[string]string{"look": "looks", "cast": "characters", "place_instance": "locations", "prop_instance": "props"}[kind]
		if _, err := tx.Exec(ctx, `UPDATE production_versions SET data=jsonb_set(data,'{approval}','"rejected"') WHERE id=$1 AND owner_user_id=$2`, version, owner); err != nil {
			return err
		}
		field := "primaryVersionId"
		if kind == "cast" {
			field = "canonicalVersionId"
		}
		if _, err := tx.Exec(ctx, `UPDATE production_`+entity+` SET data=CASE WHEN data->>$3=$4 THEN data-$3 ELSE data END WHERE id=$1 AND owner_user_id=$2`, id, owner, field, version); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE production_references SET data=data-'activeVersionId' WHERE owner_user_id=$1 AND data->>'activeVersionId'=$2`, owner, version); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE projects p SET production_revision=production_revision+1,last_write_hash=NULL FROM production_`+entity+` e WHERE e.id=$1 AND e.owner_user_id=$2 AND p.id=e.project_id AND p.owner_user_id=e.owner_user_id`, id, owner); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

type GenerateInput struct {
	Views           []string `json:"views"`
	Count           int      `json:"count"`
	Prompt          string   `json:"prompt"`
	SourceVersionID string   `json:"sourceVersionId,omitempty"`
}
type Generation struct {
	ID        string       `json:"id"`
	SubjectID string       `json:"subjectId"`
	Jobs      []engine.Job `json:"jobs"`
}

func (s *Service) Generate(ctx context.Context, owner, kind, id, key string, in GenerateInput) (Generation, error) {
	if key == "" || len(key) > 200 || in.Count < 1 || in.Count > 4 || len(in.Views) != 1 || len(in.Prompt) > 10000 {
		return Generation{}, invalid("Invalid generation request")
	}
	view := in.Views[0]
	if !supportsView(kind, view) {
		return Generation{}, invalid("Unsupported reference view")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Generation{}, err
	}
	defer tx.Rollback(ctx)
	subject, identity, identityAsset, err := load(ctx, tx, owner, kind, id)
	if err != nil {
		return Generation{}, err
	}
	raw, _ := json.Marshal(in)
	batch := uuid.NewString()
	var saved json.RawMessage
	err = tx.QueryRow(ctx, `SELECT id::text,input_json FROM reference_batches WHERE owner_user_id=$1 AND kind=$2 AND subject_id=$3 AND idempotency_key=$4`, owner, kind, id, key).Scan(&batch, &saved)
	if err == nil {
		var existing GenerateInput
		_ = json.Unmarshal(saved, &existing)
		encoded, _ := json.Marshal(existing)
		if string(encoded) != string(raw) {
			return Generation{}, engine.ErrIdempotencyConflict
		}
		jobs, err := s.batchJobs(ctx, tx, owner, batch)
		if err != nil {
			return Generation{}, err
		}
		return Generation{batch, id, jobs}, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Generation{}, err
	}
	if (kind == "look" || (kind == "cast" && view != "front")) && identityAsset == "" {
		return Generation{}, invalid("Select a character identity before generating a look")
	}
	if _, err := tx.Exec(ctx, `INSERT INTO reference_batches(id,owner_user_id,kind,subject_id,idempotency_key,input_json) VALUES($1,$2,$3,$4,$5,$6)`, batch, owner, kind, id, key, raw); err != nil {
		return Generation{}, err
	}
	refs := []imageinput.Reference{}
	if identityAsset != "" {
		refs = append(refs, imageinput.Reference{AssetID: identityAsset, Role: "identity"})
	}
	frontVersion := ""
	if view != "front" {
		var asset string
		if kind == "cast" {
			asset = identityAsset
			frontVersion = identity
		} else {
			err := tx.QueryRow(ctx, `SELECT v.asset_id::text,v.id::text FROM reference_selections s JOIN reference_image_versions v ON v.id=s.version_id AND v.owner_user_id=s.owner_user_id WHERE s.owner_user_id=$1 AND s.kind=$2 AND s.subject_id=$3 AND s.view='front' AND v.subject_revision=$4 AND v.identity_version_id IS NOT DISTINCT FROM NULLIF($5,'')`, owner, kind, id, subject.Revision, identity).Scan(&asset, &frontVersion)
			if err != nil {
				return Generation{}, invalid("Select a current front view first")
			}
		}
		refs = append(refs, imageinput.Reference{AssetID: asset, Role: "continuity"})
	}

	if kind == "cast" && view == "front" {
		identity = ""
	}
	source := ""
	if in.SourceVersionID != "" {
		err := tx.QueryRow(ctx, `SELECT asset_id::text FROM reference_image_versions WHERE id=$1 AND owner_user_id=$2 AND kind=$3 AND subject_id=$4 AND view=$5 AND subject_revision=$6`, in.SourceVersionID, owner, kind, id, view, subject.Revision).Scan(&source)
		if err != nil {
			return Generation{}, apperr.ErrNotFound
		}
	}
	result := Generation{ID: batch, SubjectID: id, Jobs: []engine.Job{}}
	for i := 0; i < in.Count; i++ {
		input, _ := json.Marshal(imageinput.Input{Prompt: subject.Name + "\n" + subject.Description + "\nView: " + view + "\n" + in.Prompt, References: refs, SourceAssetID: source})
		operation := "generate_image"
		if source != "" {
			operation = "edit_image"
		}
		job, err := s.jobs.SubmitTx(ctx, tx, owner, batch+":"+uuid.NewString(), engine.Submission{Operation: operation, Input: input})
		if err != nil {
			return Generation{}, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO reference_generations(job_id,owner_user_id,batch_id,kind,subject_id,view,subject_revision,identity_version_id,front_version_id) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),NULLIF($9,''))`, job.ID, owner, batch, kind, id, view, subject.Revision, identity, frontVersion); err != nil {
			return Generation{}, err
		}
		result.Jobs = append(result.Jobs, job)
	}
	return result, tx.Commit(ctx)
}
func (s *Service) batchJobs(ctx context.Context, tx pgx.Tx, owner, batch string) ([]engine.Job, error) {
	rows, err := tx.Query(ctx, `SELECT j.id::text,j.project_id::text,j.operation,j.input_schema_version,j.input_json,j.status,j.created_at,j.updated_at FROM jobs j JOIN reference_generations g ON g.job_id=j.id AND g.owner_user_id=j.owner_user_id WHERE g.owner_user_id=$1 AND g.batch_id=$2 ORDER BY j.created_at,j.id`, owner, batch)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (engine.Job, error) {
		var job engine.Job
		err := row.Scan(&job.ID, &job.ProjectID, &job.Operation, &job.InputSchemaVersion, &job.Input, &job.Status, &job.CreatedAt, &job.UpdatedAt)
		return job, err
	})
}
func Publish(ctx context.Context, tx pgx.Tx, owner, job string) error {
	version := uuid.NewString()
	tag, err := tx.Exec(ctx, `INSERT INTO reference_image_versions(id,owner_user_id,kind,subject_id,view,subject_revision,identity_version_id,front_version_id,asset_id,producer_job_id) SELECT $3,g.owner_user_id,g.kind,g.subject_id,g.view,g.subject_revision,g.identity_version_id,g.front_version_id,a.id,g.job_id FROM reference_generations g JOIN assets a ON a.producer_job_id=g.job_id AND a.owner_user_id=g.owner_user_id JOIN asset_files f ON f.asset_id=a.id AND f.role='original' WHERE g.job_id=$1 AND g.owner_user_id=$2 ON CONFLICT(producer_job_id) DO NOTHING`, job, owner, version)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	var kind, id, view, asset string
	var revision int
	var identity *string
	err = tx.QueryRow(ctx, `SELECT kind,subject_id,view,asset_id::text,subject_revision,identity_version_id FROM reference_image_versions WHERE id=$1 AND owner_user_id=$2`, version, owner).Scan(&kind, &id, &view, &asset, &revision, &identity)
	if err != nil {
		return err
	}
	if table(kind) != "" {
		return nil
	}
	entity := map[string]string{"look": "looks", "cast": "characters", "place_instance": "locations", "prop_instance": "props"}[kind]
	var project string
	if err := tx.QueryRow(ctx, `SELECT project_id::text FROM production_`+entity+` WHERE id=$1 AND owner_user_id=$2`, id, owner).Scan(&project); err != nil {
		return err
	}
	var locked bool
	if err := tx.QueryRow(ctx, `SELECT true FROM projects WHERE id=$1 AND owner_user_id=$2 FOR NO KEY UPDATE`, project, owner).Scan(&locked); err != nil {
		return err
	}

	media, _ := json.Marshal(map[string]any{"id": asset, "serverAssetId": asset, "projectId": project, "title": "Generated reference", "kind": "image", "provenance": "Generated by job " + job})
	if _, err := tx.Exec(ctx, `INSERT INTO production_media(id,project_id,owner_user_id,asset_id,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`, asset, project, owner, asset, media); err != nil {
		return err
	}
	ownerKind := map[string]string{"look": "look", "cast": "identity", "place_instance": "location", "prop_instance": "prop"}[kind]
	ownerID := id
	if kind == "cast" && view != "front" {
		ownerKind = "reference"
		ownerID = "reference-" + id + "-" + view
	}
	fields := map[string]any{"id": version, "projectId": project, "ownerKind": ownerKind, "ownerId": ownerID, "assetId": asset, "approval": "needs_review", "revision": revision, "sourceIdentityVersionId": identity, "specification": "Generated reference", "createdAt": time.Now().UnixMilli(), "viewType": view}
	if identity == nil {
		delete(fields, "sourceIdentityVersionId")
	}
	if kind == "look" && view != "front" {
		var front *string
		if err := tx.QueryRow(ctx, `SELECT front_version_id FROM reference_image_versions WHERE id=$1 AND owner_user_id=$2`, version, owner).Scan(&front); err != nil {
			return err
		}
		if front != nil {
			fields["sourceLookVersionId"] = *front
		}
	}
	data, _ := json.Marshal(fields)
	_, err = tx.Exec(ctx, `INSERT INTO production_versions(id,project_id,owner_user_id,parent_id,revision,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`, version, project, owner, ownerID, revision, data)
	return err
}

type UploadInput struct {
	AssetID string `json:"assetId"`
	View    string `json:"view"`
}

func (s *Service) Upload(ctx context.Context, owner, kind, id, key string, in UploadInput) (Version, error) {
	if key == "" || len(key) > 200 {
		return Version{}, invalid("An upload key is required")
	}
	if !supportsView(kind, in.View) {
		return Version{}, invalid("Unsupported reference view")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Version{}, err
	}
	defer tx.Rollback(ctx)
	subject, identity, _, err := load(ctx, tx, owner, kind, id)
	if err != nil {
		return Version{}, err
	}
	if kind == "cast" && in.View == "front" {
		identity = ""
	}
	if (kind == "look" || (kind == "cast" && in.View != "front")) && identity == "" {
		return Version{}, invalid("Select a character identity first")
	}
	version := Version{ID: uuid.NewSHA1(uuid.NameSpaceOID, []byte("reference-upload:"+owner+":"+kind+":"+id+":"+key)).String(), SubjectID: id, View: in.View, AssetID: in.AssetID, Revision: subject.Revision, Approval: "needs_review"}
	if identity != "" {
		version.IdentityVersionID = &identity
	}
	frontVersion := ""
	if in.View != "front" {
		if kind == "cast" {
			frontVersion = identity
		} else {
			if err := tx.QueryRow(ctx, `SELECT s.version_id::text FROM reference_selections s JOIN reference_image_versions v ON v.id=s.version_id AND v.owner_user_id=s.owner_user_id WHERE s.owner_user_id=$1 AND s.kind=$2 AND s.subject_id=$3 AND s.view='front' AND v.subject_revision=$4`, owner, kind, id, subject.Revision).Scan(&frontVersion); err != nil {
				return Version{}, invalid("Select a current front view first")
			}
		}
	}

	var valid bool
	if err := tx.QueryRow(ctx, `SELECT true FROM assets a JOIN asset_files f ON f.asset_id=a.id AND f.role='original' WHERE a.id=$1 AND a.owner_user_id=$2 AND a.kind='image' AND a.deleted_at IS NULL FOR SHARE OF a`, in.AssetID, owner).Scan(&valid); err != nil {
		return Version{}, apperr.ErrNotFound
	}
	tag, err := tx.Exec(ctx, `INSERT INTO reference_image_versions(id,owner_user_id,kind,subject_id,view,subject_revision,identity_version_id,asset_id,front_version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,'')) ON CONFLICT(id) DO NOTHING`, version.ID, owner, kind, id, in.View, subject.Revision, version.IdentityVersionID, in.AssetID, frontVersion)
	if err != nil {
		return Version{}, err
	}
	if tag.RowsAffected() == 0 {
		var asset, view string
		err := tx.QueryRow(ctx, `SELECT asset_id::text,view,subject_revision,identity_version_id,approval,created_at FROM reference_image_versions WHERE id=$1 AND owner_user_id=$2 AND kind=$3 AND subject_id=$4`, version.ID, owner, kind, id).Scan(&asset, &view, &version.Revision, &version.IdentityVersionID, &version.Approval, &version.CreatedAt)
		if err != nil {
			return Version{}, err
		}
		if asset != in.AssetID || view != in.View {
			return Version{}, engine.ErrIdempotencyConflict
		}
		return version, tx.Commit(ctx)
	}
	if err := tx.QueryRow(ctx, `SELECT created_at FROM reference_image_versions WHERE id=$1 AND owner_user_id=$2`, version.ID, owner).Scan(&version.CreatedAt); err != nil {
		return Version{}, err
	}
	if table(kind) == "" {
		entity := map[string]string{"look": "looks", "cast": "characters", "place_instance": "locations", "prop_instance": "props"}[kind]
		var project string
		if err := tx.QueryRow(ctx, `SELECT project_id::text FROM production_`+entity+` WHERE id=$1 AND owner_user_id=$2`, id, owner).Scan(&project); err != nil {
			return Version{}, err
		}
		media, _ := json.Marshal(map[string]any{"id": in.AssetID, "serverAssetId": in.AssetID, "projectId": project, "title": "Uploaded reference", "kind": "image", "provenance": "Uploaded reference"})
		if _, err := tx.Exec(ctx, `INSERT INTO production_media(id,project_id,owner_user_id,asset_id,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`, in.AssetID, project, owner, in.AssetID, media); err != nil {
			return Version{}, err
		}
		ownerKind := map[string]string{"look": "look", "cast": "identity", "place_instance": "location", "prop_instance": "prop"}[kind]
		ownerID := id
		if kind == "cast" && in.View != "front" {
			ownerKind = "reference"
			ownerID = "reference-" + id + "-" + in.View
		}
		fields := map[string]any{"id": version.ID, "projectId": project, "ownerKind": ownerKind, "ownerId": ownerID, "assetId": in.AssetID, "approval": "needs_review", "revision": subject.Revision, "specification": "Uploaded reference", "createdAt": version.CreatedAt.UnixMilli(), "viewType": in.View}
		if identity != "" {
			fields["sourceIdentityVersionId"] = identity
		}
		if kind == "look" && in.View != "front" {
			fields["sourceLookVersionId"] = frontVersion
		}
		data, _ := json.Marshal(fields)
		if _, err := tx.Exec(ctx, `INSERT INTO production_versions(id,project_id,owner_user_id,parent_id,revision,data) VALUES($1,$2,$3,$4,$5,$6)`, version.ID, project, owner, ownerID, subject.Revision, data); err != nil {
			return Version{}, err
		}
	}
	return version, tx.Commit(ctx)
}

func supportsView(kind, view string) bool {
	var views []string
	switch kind {
	case "place", "place_instance":
		views = []string{"front", "interior", "entrance", "detail"}
	case "prop", "prop_instance":
		views = []string{"front", "back", "side", "detail"}
	case "look", "cast":
		views = []string{"front", "three_quarter", "profile", "right_profile", "full_body", "back", "full_body_three_quarter"}
	}
	for _, allowed := range views {
		if view == allowed {
			return true
		}
	}
	return false
}
