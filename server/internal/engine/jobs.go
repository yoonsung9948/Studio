package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"nori/studio/server/internal/billing"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/platform/queue"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
)

var ErrIdempotencyConflict = &apperr.ConflictError{Code: "idempotency_conflict", Message: "idempotency key already used with different input"}

// JobService submits jobs and reads their state. Workers execute them.
type JobService struct {
	pool     *pgxpool.Pool
	queue    *queue.Client
	registry *Registry
}

func NewJobService(pool *pgxpool.Pool, queue *queue.Client, registry *Registry) *JobService {
	return &JobService{pool: pool, queue: queue, registry: registry}
}

type Submission struct {
	ProjectID *string         `json:"projectId"`
	Operation string          `json:"operation"`
	Input     json.RawMessage `json:"input"`
}

func (s *JobService) Submit(ctx context.Context, ownerID, key string, req Submission) (Job, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Job{}, err
	}
	defer tx.Rollback(ctx)
	job, err := s.SubmitTx(ctx, tx, ownerID, key, req)
	if err != nil {
		return Job{}, err
	}
	return job, tx.Commit(ctx)
}

// SubmitTx schedules work inside the caller's transaction.
func (s *JobService) SubmitTx(ctx context.Context, tx pgx.Tx, ownerID, key string, req Submission) (Job, error) {
	if len(key) == 0 || len(key) > 200 || strings.TrimSpace(key) != key {
		return Job{}, &apperr.ValidationError{Message: "Idempotency-Key must contain 1-200 bytes without surrounding whitespace"}
	}
	op, ok := s.registry.Get(req.Operation)
	if !ok {
		return Job{}, &apperr.ValidationError{Message: "unsupported operation"}
	}
	canonical, err := op.Canonicalize(req.Input)
	if err != nil {
		return Job{}, &apperr.ValidationError{Message: err.Error()}
	}
	version := op.InputVersion()
	scope := "standalone"
	if req.ProjectID != nil {
		id, err := uuid.Parse(*req.ProjectID)
		if err != nil {
			return Job{}, &apperr.ValidationError{Message: "invalid project ID"}
		}
		projectID := id.String()
		req.ProjectID = &projectID
		scope = "project:" + projectID
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL)`, projectID, ownerID).Scan(&exists); err != nil {
			return Job{}, err
		}
		if !exists {
			return Job{}, apperr.ErrNotFound
		}
	}
	// Project and standalone submissions have separate idempotency scopes.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, ownerID+":"+scope+":"+key); err != nil {
		return Job{}, err
	}
	var existingID string
	var matches bool
	err = tx.QueryRow(ctx, `SELECT id::text, operation=$3 AND input_schema_version=$4 AND input_json=$5::jsonb FROM jobs WHERE project_id IS NOT DISTINCT FROM $1::uuid AND idempotency_key=$2 AND owner_user_id=$6`, req.ProjectID, key, req.Operation, version, string(canonical), ownerID).Scan(&existingID, &matches)
	if err == nil {
		if !matches {
			return Job{}, ErrIdempotencyConflict
		}
		j := Job{ID: existingID, ProjectID: req.ProjectID, Operation: req.Operation, InputSchemaVersion: version, Input: canonical}
		err := tx.QueryRow(ctx, `SELECT status,created_at,updated_at FROM jobs WHERE id=$1 AND owner_user_id=$2`, existingID, ownerID).Scan(&j.Status, &j.CreatedAt, &j.UpdatedAt)
		return j, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Job{}, err
	}
	if references, ok := op.(AssetReferencer); ok {
		refs, err := references.ReferencedAssets(canonical)
		if err != nil {
			return Job{}, &apperr.ValidationError{Message: "invalid asset references"}
		}
		for _, ref := range refs {
			var kind string
			err := tx.QueryRow(ctx, `SELECT a.kind FROM assets a JOIN asset_files f ON f.asset_id=a.id AND f.role='original' WHERE a.id=$1 AND a.owner_user_id=$2 AND a.deleted_at IS NULL FOR SHARE OF a`, ref.ID, ownerID).Scan(&kind)
			if errors.Is(err, pgx.ErrNoRows) {
				return Job{}, apperr.ErrNotFound
			}
			if err != nil {
				return Job{}, err
			}
			if kind != ref.Kind {
				return Job{}, &apperr.ValidationError{Message: "unsupported reference asset kind"}
			}
		}
	}
	id := uuid.NewString()
	queued, err := s.queue.InsertTx(ctx, tx, JobArgs{JobID: id}, &river.InsertOpts{Queue: op.Queue(), MaxAttempts: maxAttempts})
	if err != nil {
		return Job{}, fmt.Errorf("enqueue job: %w", err)
	}
	j := Job{ID: id, ProjectID: req.ProjectID, Operation: req.Operation, InputSchemaVersion: version, Input: canonical, Status: "queued"}
	err = tx.QueryRow(ctx, `INSERT INTO jobs(id,project_id,operation,input_schema_version,input_json,idempotency_key,river_job_id,owner_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING created_at,updated_at`, id, req.ProjectID, req.Operation, version, canonical, key, queued.Job.ID, ownerID).Scan(&j.CreatedAt, &j.UpdatedAt)
	if err != nil {
		return Job{}, err
	}
	if err := billing.Reserve(ctx, tx, ownerID, id, req.Operation, canonical); err != nil {
		return Job{}, err
	}
	return j, nil
}

func (s *JobService) Get(ctx context.Context, ownerID, id string) (JobDetail, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return JobDetail{}, err
	}
	defer tx.Rollback(ctx)
	d := JobDetail{Attempts: []Attempt{}}
	var code, message *string
	var queueState *string
	err = tx.QueryRow(ctx, `SELECT j.id::text,j.project_id::text,j.operation,j.input_schema_version,j.input_json,j.status,j.step,j.error_code,j.error_message,j.created_at,j.updated_at,r.state::text FROM jobs j LEFT JOIN river_job r ON r.id=j.river_job_id WHERE j.id=$1 AND j.owner_user_id=$2`, id, ownerID).Scan(&d.ID, &d.ProjectID, &d.Operation, &d.InputSchemaVersion, &d.Input, &d.Status, &d.Step, &code, &message, &d.CreatedAt, &d.UpdatedAt, &queueState)
	if errors.Is(err, pgx.ErrNoRows) {
		return JobDetail{}, apperr.ErrNotFound
	}
	if err != nil {
		return JobDetail{}, err
	}
	if code != nil {
		d.Error = &Failure{Code: *code, Message: *message}
	}
	// River can exhaust a job after a process crash without calling our worker.
	if d.Status != "succeeded" && d.Status != "failed" && queueState != nil && (*queueState == "discarded" || *queueState == "cancelled") {
		d.Status = "failed"
		d.Error = &Failure{Code: "execution_stopped", Message: "Job execution stopped before a result was saved."}
	}
	artifacts, err := tx.Query(ctx, `SELECT a.id::text,a.kind,a.schema_version,a.content_json,a.created_at,m.id::text FROM artifacts a JOIN jobs j ON j.id=a.producer_job_id LEFT JOIN assets m ON m.source_artifact_id=a.id WHERE a.producer_job_id=$1 AND j.owner_user_id=$2 ORDER BY a.position`, id, ownerID)
	if err != nil {
		return JobDetail{}, err
	}
	d.Results, err = pgx.CollectRows(artifacts, func(row pgx.CollectableRow) (Artifact, error) {
		var a Artifact
		err := row.Scan(&a.ID, &a.Kind, &a.SchemaVersion, &a.Content, &a.CreatedAt, &a.AssetID)
		return a, err
	})
	if err != nil {
		return JobDetail{}, err
	}
	rows, err := tx.Query(ctx, `SELECT a.number,a.provider,a.model,a.status,a.error_code,a.error_message,a.started_at,a.finished_at FROM job_attempts a JOIN jobs j ON j.id=a.job_id WHERE a.job_id=$1 AND j.owner_user_id=$2 ORDER BY a.number`, id, ownerID)
	if err != nil {
		return JobDetail{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var a Attempt
		var code, message *string
		if err := rows.Scan(&a.Number, &a.Provider, &a.Model, &a.Status, &code, &message, &a.StartedAt, &a.FinishedAt); err != nil {
			return JobDetail{}, err
		}
		if code != nil {
			a.Error = &Failure{Code: *code, Message: *message}
		}
		d.Attempts = append(d.Attempts, a)
	}
	if err := rows.Err(); err != nil {
		return JobDetail{}, err
	}
	rows.Close()
	return d, tx.Commit(ctx)
}
