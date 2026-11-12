package production

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	imageinput "nori/studio/server/internal/domain/image"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/apperr"
)

type GenerateInput struct {
	Count              int                    `json:"count,omitempty"`
	Kind               string                 `json:"kind"`
	ReferenceSnapshots []Record               `json:"referenceSnapshots,omitempty"`
	Snapshot           Record                 `json:"snapshot"`
	Prompt             string                 `json:"prompt"`
	References         []imageinput.Reference `json:"references"`
	SourceAssetID      string                 `json:"sourceAssetId,omitempty"`
	AspectRatio        string                 `json:"aspectRatio"`
	DurationSeconds    int                    `json:"durationSeconds"`
}

func (s *Service) Generate(ctx context.Context, owner, project, shot, key string, in GenerateInput) (engine.Job, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return engine.Job{}, err
	}
	defer tx.Rollback(ctx)
	job, err := s.generateTx(ctx, tx, owner, project, shot, key, in)
	if err != nil {
		return engine.Job{}, err
	}
	return job, tx.Commit(ctx)
}
func (s *Service) GenerateBatch(ctx context.Context, owner, project, shot, key string, in GenerateInput) ([]engine.Job, error) {
	if strings.TrimSpace(key) == "" || len(key) > 180 {
		return nil, invalid("An idempotency key of 1-180 bytes is required")
	}
	count := in.Count
	if count == 0 {
		count = 1
	}
	if count < 1 || count > 4 {
		return nil, invalid("Choose 1-4 candidates")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var accessible bool
	if err := tx.QueryRow(ctx, `SELECT true FROM production_shots s JOIN projects p ON p.id=s.project_id AND p.owner_user_id=s.owner_user_id WHERE s.id=$1 AND s.project_id=$2 AND s.owner_user_id=$3 AND s.deleted_at IS NULL AND p.deleted_at IS NULL`, shot, project, owner).Scan(&accessible); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.ErrNotFound
		}
		return nil, err
	}
	in.Count = count
	raw, _ := json.Marshal(in)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, owner+":"+project+":"+key); err != nil {
		return nil, err
	}
	var same bool
	err = tx.QueryRow(ctx, `INSERT INTO production_generation_batches(owner_user_id,project_id,shot_id,idempotency_key,input_json) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_user_id,project_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING shot_id=$3 AND input_json=$5::jsonb`, owner, project, shot, key, raw).Scan(&same)
	if err != nil {
		return nil, err
	}
	if !same {
		return nil, engine.ErrIdempotencyConflict
	}

	jobs := []engine.Job{}
	for i := 0; i < count; i++ {
		job, err := s.generateTx(ctx, tx, owner, project, shot, fmt.Sprintf("%s:%d", key, i), in)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	return jobs, tx.Commit(ctx)
}
func (s *Service) generateTx(ctx context.Context, tx pgx.Tx, owner, project, shot, key string, in GenerateInput) (engine.Job, error) {
	if in.Kind != "image" && in.Kind != "video" {
		return engine.Job{}, invalid("Unsupported generation kind")
	}
	if in.Kind == "video" && (len(in.References) > 0 || in.SourceAssetID != "" || in.Snapshot.Text("startingFrameAssetId") != "" || in.Snapshot.Text("endingFrameAssetId") != "") {
		return engine.Job{}, invalid("Video conditioning requires a supporting video provider")
	}
	var err error
	var raw json.RawMessage
	err = tx.QueryRow(ctx, `SELECT s.data FROM production_shots s JOIN projects p ON p.id=s.project_id AND p.owner_user_id=s.owner_user_id WHERE s.id=$1 AND s.project_id=$2 AND s.owner_user_id=$3 AND s.deleted_at IS NULL AND p.deleted_at IS NULL FOR SHARE OF s`, shot, project, owner).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return engine.Job{}, apperr.ErrNotFound
	}
	if err != nil {
		return engine.Job{}, err
	}
	var record Record
	_ = json.Unmarshal(raw, &record)
	if record.Flag("archived") || record.Flag("locked") {
		return engine.Job{}, invalid("Shot is archived or locked")
	}
	var input []byte
	operation := "generate_image"
	if in.Kind == "image" {
		if in.SourceAssetID != "" {
			operation = "edit_image"
		}
		input, err = json.Marshal(imageinput.Input{Prompt: in.Prompt, References: in.References, SourceAssetID: in.SourceAssetID, Settings: imageinput.Settings{AspectRatio: in.AspectRatio}})
	} else {
		operation = "generate_video"
		input, err = json.Marshal(map[string]any{"prompt": in.Prompt, "durationSeconds": in.DurationSeconds, "resolution": "768P"})
	}
	if err != nil {
		return engine.Job{}, err
	}
	job, err := s.jobs.SubmitTx(ctx, tx, owner, key, engine.Submission{ProjectID: &project, Operation: operation, Input: input})
	if err != nil {
		return engine.Job{}, err
	}
	if err := validateSnapshotReferences(ctx, tx, owner, project, in.ReferenceSnapshots); err != nil {
		return engine.Job{}, err
	}
	snapshotInput := Record{}
	for key, value := range in.Snapshot {
		snapshotInput[key] = value
	}
	snapshotInput["_references"], _ = json.Marshal(in.ReferenceSnapshots)
	snapshot, _ := json.Marshal(snapshotInput)

	tag, err := tx.Exec(ctx, `INSERT INTO production_generation_jobs(job_id,owner_user_id,project_id,shot_id,shot_revision,kind,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(job_id) DO NOTHING`, job.ID, owner, project, shot, max(record.Number("revision"), 1), in.Kind, snapshot)
	if err != nil {
		return engine.Job{}, err
	}
	if tag.RowsAffected() == 0 {
		var savedShot string
		err := tx.QueryRow(ctx, `SELECT shot_id FROM production_generation_jobs WHERE job_id=$1 AND owner_user_id=$2`, job.ID, owner).Scan(&savedShot)
		if err != nil {
			return engine.Job{}, err
		}
		if savedShot != shot {
			return engine.Job{}, engine.ErrIdempotencyConflict
		}
	}
	return job, nil
}

// Publish keeps a candidate even when the shot changed or was archived during generation.
func Publish(ctx context.Context, tx pgx.Tx, owner, job string) error {
	var project, shot, kind, asset string
	var revision int
	var snapshot json.RawMessage
	err := tx.QueryRow(ctx, `SELECT g.project_id::text,g.shot_id,g.kind,g.shot_revision,g.snapshot,a.id::text FROM production_generation_jobs g JOIN assets a ON a.producer_job_id=g.job_id AND a.owner_user_id=g.owner_user_id JOIN asset_files f ON f.asset_id=a.id AND f.role='original' WHERE g.job_id=$1 AND g.owner_user_id=$2`, job, owner).Scan(&project, &shot, &kind, &revision, &snapshot, &asset)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var locked bool
	if err := tx.QueryRow(ctx, `SELECT true FROM projects WHERE id=$1 AND owner_user_id=$2 FOR NO KEY UPDATE`, project, owner).Scan(&locked); err != nil {
		return err
	}
	var inputs Record
	_ = json.Unmarshal(snapshot, &inputs)
	media, _ := json.Marshal(map[string]any{"id": asset, "serverAssetId": asset, "projectId": project, "title": "Generated " + kind, "kind": kind, "provenance": "Generated by job " + job})
	if _, err := tx.Exec(ctx, `INSERT INTO production_media(id,project_id,owner_user_id,asset_id,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`, asset, project, owner, asset, media); err != nil {
		return err
	}
	takeID := "take-" + job
	var references []Record
	_ = json.Unmarshal(inputs["_references"], &references)
	delete(inputs, "_references")
	if references == nil {
		references = []Record{}
	}
	take, _ := json.Marshal(map[string]any{"references": references, "id": takeID, "shotId": shot, "kind": kind, "revision": revision, "approved": false, "sourceFrames": max(inputs.Number("targetFrames"), 1), "assetId": asset, "createdAt": time.Now().UnixMilli(), "inputs": inputs, "producerJobId": job})
	_, err = tx.Exec(ctx, `INSERT INTO production_takes(id,project_id,owner_user_id,parent_id,revision,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`, takeID, project, owner, shot, revision, take)
	return err
}

type ActiveJob struct {
	ShotID string     `json:"shotId"`
	Job    engine.Job `json:"job"`
}

func (s *Service) ActiveJobs(ctx context.Context, owner, project string) ([]ActiveJob, error) {
	var found bool
	if err := s.pool.QueryRow(ctx, `SELECT true FROM projects WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, project, owner).Scan(&found); err != nil {
		return nil, apperr.ErrNotFound
	}
	rows, err := s.pool.Query(ctx, `SELECT g.shot_id,j.id::text,j.project_id::text,j.operation,j.input_schema_version,j.input_json,j.status,j.created_at,j.updated_at FROM production_generation_jobs g JOIN jobs j ON j.id=g.job_id AND j.owner_user_id=g.owner_user_id WHERE g.project_id=$1 AND g.owner_user_id=$2 AND j.status IN ('queued','running')`, project, owner)
	if err != nil {
		return nil, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (ActiveJob, error) {
		var item ActiveJob
		err := row.Scan(&item.ShotID, &item.Job.ID, &item.Job.ProjectID, &item.Job.Operation, &item.Job.InputSchemaVersion, &item.Job.Input, &item.Job.Status, &item.Job.CreatedAt, &item.Job.UpdatedAt)
		return item, err
	})
	if items == nil {
		items = []ActiveJob{}
	}
	return items, err
}

func validateSnapshotReferences(ctx context.Context, tx pgx.Tx, owner, project string, references []Record) error {
	for _, reference := range references {
		for _, field := range []string{"characterId", "identityVersionId", "lookVersionId"} {
			value := reference.Text(field)
			if value == "" {
				continue
			}
			table := "versions"
			if field == "characterId" {
				table = "characters"
			}
			var found bool
			err := tx.QueryRow(ctx, `SELECT true FROM production_`+table+` WHERE id=$1 AND project_id=$2 AND owner_user_id=$3 AND deleted_at IS NULL`, value, project, owner).Scan(&found)
			if errors.Is(err, pgx.ErrNoRows) {
				return apperr.ErrNotFound
			}
			if err != nil {
				return err
			}
		}
		for _, version := range reference.Strings("referenceVersionIds") {
			var found bool
			err := tx.QueryRow(ctx, `SELECT true FROM production_versions WHERE id=$1 AND project_id=$2 AND owner_user_id=$3 AND deleted_at IS NULL`, version, project, owner).Scan(&found)
			if errors.Is(err, pgx.ErrNoRows) {
				return apperr.ErrNotFound
			}
			if err != nil {
				return err
			}
		}
	}
	return nil
}
