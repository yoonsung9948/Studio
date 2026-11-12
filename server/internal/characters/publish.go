package characters

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Publish runs after asset publication, in the worker's completion transaction.
// Deleted characters retain their history; generation never selects a version.
func Publish(ctx context.Context, tx pgx.Tx, owner, jobID string) error {
	var characterID, view, prompt string
	var revision int
	var sourceIdentity, assetID *string
	err := tx.QueryRow(ctx, `SELECT g.character_id::text,g.view,g.appearance_revision,g.source_identity_version_id::text,g.prompt,CASE WHEN f.id IS NOT NULL THEN a.id::text END
 FROM character_generations g
 LEFT JOIN assets a ON a.producer_job_id=g.job_id AND a.owner_user_id=g.owner_user_id AND a.kind='image'
 LEFT JOIN asset_files f ON f.asset_id=a.id AND f.role='original'
 WHERE g.job_id=$1 AND g.owner_user_id=$2`, jobID, owner).Scan(&characterID, &view, &revision, &sourceIdentity, &prompt, &assetID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if assetID == nil {
		return errors.New("character generation has no stored image")
	}
	_, err = tx.Exec(ctx, `INSERT INTO character_image_versions(id,character_id,owner_user_id,view,asset_id,producer_job_id,appearance_revision,source_identity_version_id,prompt)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(producer_job_id) DO NOTHING`, uuid.NewString(), characterID, owner, view, assetID, jobID, revision, sourceIdentity, prompt)
	return err
}
