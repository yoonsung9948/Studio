package engine

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"nori/studio/server/internal/platform/apperr"
)

const (
	DefaultJobListLimit = 20
	MaxJobListLimit     = 100
)

type ListJobsParams struct {
	Limit     int
	Cursor    string
	ProjectID *string
	Status    string
	Operation string
}

type jobCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

func decodeCursor(token string) (jobCursor, error) {
	invalid := &apperr.ValidationError{Message: "invalid cursor"}
	if len(token) > 1024 {
		return jobCursor{}, invalid
	}
	data, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return jobCursor{}, invalid
	}
	var c jobCursor
	if json.Unmarshal(data, &c) != nil || c.CreatedAt.IsZero() {
		return jobCursor{}, invalid
	}
	id, err := uuid.Parse(c.ID)
	if err != nil {
		return jobCursor{}, invalid
	}
	c.ID = id.String()
	return c, nil
}

func encodeCursor(job Job) (string, error) {
	data, err := json.Marshal(jobCursor{CreatedAt: job.CreatedAt, ID: job.ID})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func (s *JobService) List(ctx context.Context, ownerID string, params ListJobsParams) (JobPage, error) {
	if params.Limit == 0 {
		params.Limit = DefaultJobListLimit
	}
	if params.Limit < 1 || params.Limit > MaxJobListLimit {
		return JobPage{}, &apperr.ValidationError{Message: "limit must be between 1 and 100"}
	}
	if params.ProjectID != nil {
		if _, err := uuid.Parse(*params.ProjectID); err != nil {
			return JobPage{}, &apperr.ValidationError{Message: "invalid project ID"}
		}
	}
	switch params.Status {
	case "", "queued", "running", "succeeded", "failed":
	default:
		return JobPage{}, &apperr.ValidationError{Message: "unsupported job status"}
	}
	var beforeTime *time.Time
	var beforeID *string
	if params.Cursor != "" {
		c, err := decodeCursor(params.Cursor)
		if err != nil {
			return JobPage{}, err
		}
		beforeTime, beforeID = &c.CreatedAt, &c.ID
	}
	if params.ProjectID != nil {
		var owned bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1 AND owner_user_id=$2)`, params.ProjectID, ownerID).Scan(&owned); err != nil {
			return JobPage{}, err
		}
		if !owned {
			return JobPage{}, apperr.ErrNotFound
		}
	}
	// Use the same effective status as Get while crash reconciliation is pending.
	rows, err := s.pool.Query(ctx, `WITH visible AS (
 SELECT j.id,j.project_id,j.operation,j.input_schema_version,j.step,j.created_at,j.updated_at,
 CASE WHEN j.status IN ('queued','running') AND r.state IN ('discarded','cancelled') THEN 'failed' ELSE j.status END AS status,
 CASE WHEN j.status IN ('queued','running') AND r.state IN ('discarded','cancelled') THEN 'execution_stopped' ELSE j.error_code END AS error_code,
 CASE WHEN j.status IN ('queued','running') AND r.state IN ('discarded','cancelled') THEN 'Job execution stopped before a result was saved.' ELSE j.error_message END AS error_message
 FROM jobs j LEFT JOIN river_job r ON r.id=j.river_job_id
 WHERE j.owner_user_id=$7 AND ($1::uuid IS NULL OR j.project_id=$1) AND ($2='' OR j.operation=$2)
 ) SELECT id::text,project_id::text,operation,input_schema_version,status,step,error_code,error_message,created_at,updated_at
 FROM visible WHERE ($3='' OR status=$3)
 AND ($4::timestamptz IS NULL OR (created_at,id)<($4::timestamptz,$5::uuid))
 ORDER BY created_at DESC,id DESC LIMIT $6`, params.ProjectID, params.Operation, params.Status, beforeTime, beforeID, params.Limit+1, ownerID)
	if err != nil {
		return JobPage{}, err
	}
	jobs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Job, error) {
		var j Job
		var code, message *string
		err := row.Scan(&j.ID, &j.ProjectID, &j.Operation, &j.InputSchemaVersion, &j.Status, &j.Step, &code, &message, &j.CreatedAt, &j.UpdatedAt)
		if code != nil && message != nil {
			j.Error = &Failure{Code: *code, Message: *message}
		}
		return j, err
	})
	if err != nil {
		return JobPage{}, err
	}
	if jobs == nil {
		jobs = []Job{}
	}
	page := JobPage{Items: jobs}
	if len(jobs) > params.Limit {
		page.Items = jobs[:params.Limit]
		cursor, err := encodeCursor(page.Items[len(page.Items)-1])
		if err != nil {
			return JobPage{}, err
		}
		page.NextCursor = &cursor
	}
	return page, nil
}
