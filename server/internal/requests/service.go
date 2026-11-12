package requests

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"nori/studio/server/internal/domain/interpretation"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/apperr"
)

type Submission struct {
	ProjectID *string `json:"projectId"`
	Prompt    string  `json:"prompt"`
}

type Request struct {
	ID                  string    `json:"id"`
	ProjectID           *string   `json:"projectId"`
	Prompt              string    `json:"prompt"`
	InterpretationJobID string    `json:"interpretationJobId"`
	CreatedAt           time.Time `json:"createdAt"`
}

type Accepted struct {
	Request Request    `json:"request"`
	Job     engine.Job `json:"job"`
}

type Service struct {
	pool *pgxpool.Pool
	jobs *engine.JobService
}

func NewService(pool *pgxpool.Pool, jobs *engine.JobService) *Service {
	return &Service{pool: pool, jobs: jobs}
}

func (s *Service) Submit(ctx context.Context, ownerID, key string, in Submission) (Accepted, error) {
	if key == "" || len(key) > 200 || strings.TrimSpace(key) != key {
		return Accepted{}, &apperr.ValidationError{Message: "Idempotency-Key must contain 1-200 bytes without surrounding whitespace"}
	}
	in.Prompt = strings.TrimSpace(in.Prompt)
	if err := (interpretation.Input{Prompt: in.Prompt}).Validate(); err != nil {
		return Accepted{}, &apperr.ValidationError{Message: err.Error()}
	}
	scope := "standalone"
	if in.ProjectID != nil {
		id, err := uuid.Parse(*in.ProjectID)
		if err != nil {
			return Accepted{}, &apperr.ValidationError{Message: "invalid project ID"}
		}
		normalized := id.String()
		in.ProjectID = &normalized
		scope = "project:" + normalized
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Accepted{}, err
	}
	defer tx.Rollback(ctx)
	if in.ProjectID != nil {
		var owned bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL)`, in.ProjectID, ownerID).Scan(&owned); err != nil {
			return Accepted{}, err
		}
		if !owned {
			return Accepted{}, apperr.ErrNotFound
		}
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "request:"+ownerID+":"+scope+":"+key); err != nil {
		return Accepted{}, err
	}
	r, err := scanRequest(tx.QueryRow(ctx, `SELECT id::text,project_id::text,prompt,interpretation_job_id::text,created_at FROM requests WHERE project_id IS NOT DISTINCT FROM $1::uuid AND idempotency_key=$2 AND owner_user_id=$3`, in.ProjectID, key, ownerID))
	if err == nil {
		if r.Prompt != in.Prompt {
			return Accepted{}, engine.ErrIdempotencyConflict
		}
		if err := tx.Commit(ctx); err != nil {
			return Accepted{}, err
		}
		job, err := s.jobs.Get(ctx, ownerID, r.InterpretationJobID)
		return Accepted{Request: r, Job: job.Job}, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Accepted{}, err
	}
	id := uuid.NewString()
	input, err := json.Marshal(interpretation.Input{Prompt: in.Prompt})
	if err != nil {
		return Accepted{}, err
	}
	job, err := s.jobs.SubmitTx(ctx, tx, ownerID, "request:"+id, engine.Submission{ProjectID: in.ProjectID, Operation: "interpret_request", Input: input})
	if err != nil {
		return Accepted{}, err
	}
	r, err = scanRequest(tx.QueryRow(ctx, `INSERT INTO requests(id,project_id,prompt,idempotency_key,interpretation_job_id,owner_user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text,project_id::text,prompt,interpretation_job_id::text,created_at`, id, in.ProjectID, in.Prompt, key, job.ID, ownerID))
	if err != nil {
		return Accepted{}, err
	}
	return Accepted{Request: r, Job: job}, tx.Commit(ctx)
}

func (s *Service) Get(ctx context.Context, ownerID, id string) (Request, error) {
	r, err := scanRequest(s.pool.QueryRow(ctx, `SELECT id::text,project_id::text,prompt,interpretation_job_id::text,created_at FROM requests WHERE id=$1 AND owner_user_id=$2`, id, ownerID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Request{}, apperr.ErrNotFound
	}
	return r, err
}

func scanRequest(row pgx.Row) (Request, error) {
	var r Request
	err := row.Scan(&r.ID, &r.ProjectID, &r.Prompt, &r.InterpretationJobID, &r.CreatedAt)
	return r, err
}
