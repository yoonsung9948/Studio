package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

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
	Operation string          `json:"operation"`
	Input     json.RawMessage `json:"input"`
}

func (s *JobService) Submit(ctx context.Context, projectID, key string, req Submission) (Job, error) {
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
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Job{}, err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1)`, projectID).Scan(&exists); err != nil {
		return Job{}, err
	}
	if !exists {
		return Job{}, apperr.ErrNotFound
	}
	// Serialize only submissions sharing this project and key.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, projectID+":"+key); err != nil {
		return Job{}, err
	}
	var existingID string
	var matches bool
	err = tx.QueryRow(ctx, `SELECT id::text, operation=$3 AND input_schema_version=$4 AND input_json=$5::jsonb FROM generation_jobs WHERE project_id=$1 AND idempotency_key=$2`, projectID, key, req.Operation, version, string(canonical)).Scan(&existingID, &matches)
	if err == nil {
		if !matches {
			return Job{}, ErrIdempotencyConflict
		}
		if err := tx.Commit(ctx); err != nil {
			return Job{}, err
		}
		detail, err := s.Get(ctx, existingID)
		return detail.Job, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Job{}, err
	}
	id := uuid.NewString()
	queued, err := s.queue.InsertTx(ctx, tx, JobArgs{JobID: id}, &river.InsertOpts{Queue: op.Queue(), MaxAttempts: maxAttempts})
	if err != nil {
		return Job{}, fmt.Errorf("enqueue job: %w", err)
	}
	j := Job{ID: id, ProjectID: projectID, Operation: req.Operation, InputSchemaVersion: version, Input: canonical, Status: "queued"}
	err = tx.QueryRow(ctx, `INSERT INTO generation_jobs(id,project_id,operation,input_schema_version,input_json,idempotency_key,river_job_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING created_at,updated_at`, id, projectID, req.Operation, version, canonical, key, queued.Job.ID).Scan(&j.CreatedAt, &j.UpdatedAt)
	if err != nil {
		return Job{}, err
	}
	return j, tx.Commit(ctx)
}

func (s *JobService) Get(ctx context.Context, id string) (JobDetail, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return JobDetail{}, err
	}
	defer tx.Rollback(ctx)
	d := JobDetail{Attempts: []Attempt{}}
	var code, message *string
	var queueState *string
	err = tx.QueryRow(ctx, `SELECT j.id::text,j.project_id::text,j.operation,j.input_schema_version,j.input_json,j.status,j.step,j.error_code,j.error_message,j.created_at,j.updated_at,r.state::text FROM generation_jobs j LEFT JOIN river_job r ON r.id=j.river_job_id WHERE j.id=$1`, id).Scan(&d.ID, &d.ProjectID, &d.Operation, &d.InputSchemaVersion, &d.Input, &d.Status, &d.Step, &code, &message, &d.CreatedAt, &d.UpdatedAt, &queueState)
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
	artifacts, err := tx.Query(ctx, `SELECT id::text,kind,schema_version,content_json,created_at FROM artifacts WHERE producer_job_id=$1 ORDER BY position`, id)
	if err != nil {
		return JobDetail{}, err
	}
	d.Results, err = pgx.CollectRows(artifacts, func(row pgx.CollectableRow) (Artifact, error) {
		var a Artifact
		err := row.Scan(&a.ID, &a.Kind, &a.SchemaVersion, &a.Content, &a.CreatedAt)
		return a, err
	})
	if err != nil {
		return JobDetail{}, err
	}
	rows, err := tx.Query(ctx, `SELECT number,provider,model,status,error_code,error_message,started_at,finished_at FROM job_attempts WHERE job_id=$1 ORDER BY number`, id)
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
