// Package ownership contains administrative ownership maintenance.
package ownership

import (
	"context"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"nori/studio/server/internal/platform/apperr"
)

const LegacyOwnerID = "00000000-0000-0000-0000-000000000001"

// ClaimLegacy is an explicit administrator action, never exposed over HTTP.
func ClaimLegacy(ctx context.Context, pool *pgxpool.Pool, ownerID string) error {
	id, err := uuid.Parse(ownerID)
	if err != nil {
		return &apperr.ValidationError{Message: "invalid target user ID"}
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var active bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND status='active')`, id.String()).Scan(&active); err != nil {
		return err
	}
	if !active {
		return apperr.ErrNotFound
	}
	if _, err := tx.Exec(ctx, `SET CONSTRAINTS ALL DEFERRED`); err != nil {
		return err
	}
	for _, table := range []string{"projects", "jobs", "requests", "assets"} {
		if _, err := tx.Exec(ctx, "UPDATE "+table+" SET owner_user_id=$1 WHERE owner_user_id=$2", id.String(), LegacyOwnerID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
