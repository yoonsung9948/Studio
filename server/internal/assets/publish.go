package assets

import (
	"context"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type FileDraft struct {
	Kind, Key, ContentType string
	SourceAssetID          string
	SizeBytes              int64
}

// Publish shares the worker's transaction; ownership comes from the saved job.
func Publish(ctx context.Context, tx pgx.Tx, ownerID, jobID string, position int, file FileDraft) error {
	var assetID string
	err := tx.QueryRow(ctx, `INSERT INTO assets(id,owner_user_id,project_id,producer_job_id,source_artifact_id,kind,source_asset_id)
 SELECT $3,j.owner_user_id,j.project_id,j.id,a.id,$4,NULLIF($6,'')::uuid FROM jobs j JOIN artifacts a ON a.producer_job_id=j.id
 WHERE j.id=$1 AND j.owner_user_id=$2 AND a.position=$5
 ON CONFLICT(source_artifact_id) DO UPDATE SET source_artifact_id=EXCLUDED.source_artifact_id
 RETURNING id::text`, jobID, ownerID, uuid.NewString(), file.Kind, position, file.SourceAssetID).Scan(&assetID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO asset_files(id,asset_id,role,storage_key,content_type,size_bytes) VALUES($1,$2,'original',$3,$4,$5)
 ON CONFLICT(asset_id,role) DO NOTHING`, uuid.NewString(), assetID, file.Key, file.ContentType, file.SizeBytes)
	return err
}
