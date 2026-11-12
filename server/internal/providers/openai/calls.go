package openai

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"nori/studio/server/internal/providers"
)

type callStore interface {
	Claim(context.Context, string, string, string) (bool, error)
	Record(context.Context, string, string, string, json.RawMessage) error
}

type calls struct{ pool *pgxpool.Pool }

// Claim permits only a first submission or a confirmed rate-limit retry.
func (s calls) Claim(ctx context.Context, id, hash, model string) (bool, error) {
	var claimed string
	err := s.pool.QueryRow(ctx, `INSERT INTO image_provider_calls(job_id,input_hash,model)
 VALUES($1,$2,$3) ON CONFLICT(job_id) DO UPDATE
 SET status='pending', submissions=image_provider_calls.submissions+1, updated_at=now()
 WHERE image_provider_calls.status='retryable' AND image_provider_calls.submissions<3
 AND image_provider_calls.input_hash=EXCLUDED.input_hash AND image_provider_calls.model=EXCLUDED.model
 RETURNING job_id::text`, id, hash, model).Scan(&claimed)
	if err == nil {
		return true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	var status, savedHash, savedModel string
	if err := s.pool.QueryRow(ctx, `SELECT status,input_hash,model FROM image_provider_calls WHERE job_id=$1`, id).Scan(&status, &savedHash, &savedModel); err != nil {
		return false, err
	}
	if savedHash != hash || savedModel != model {
		return false, providers.ErrUncertain
	}
	if status == "retryable" {
		return false, providers.ErrQuota
	}
	return false, providers.ErrUncertain
}

func (s calls) Record(ctx context.Context, id, status, requestID string, metadata json.RawMessage) error {
	if metadata == nil {
		metadata = json.RawMessage(`{}`)
	}
	_, err := s.pool.Exec(ctx, `UPDATE image_provider_calls SET status=$2,request_id=NULLIF($3,''),metadata=$4,updated_at=now() WHERE job_id=$1`, id, status, requestID, metadata)
	return err
}
