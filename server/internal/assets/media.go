package assets

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/platform/blob"
)

const MaxMediaBytes = 32 << 20

type MediaService struct {
	pool  *pgxpool.Pool
	files blob.Store
}

func NewMediaService(pool *pgxpool.Pool, files blob.Store) *MediaService {
	return &MediaService{pool, files}
}
func (s *MediaService) Upload(ctx context.Context, owner, key string, project *string, r io.Reader) (Detail, error) {
	if key == "" || len(key) > 200 {
		return Detail{}, &apperr.ValidationError{Message: "An idempotency key is required"}
	}
	data, err := io.ReadAll(io.LimitReader(r, MaxMediaBytes+1))
	if err != nil {
		return Detail{}, err
	}
	if len(data) == 0 || len(data) > MaxMediaBytes {
		return Detail{}, &apperr.ValidationError{Message: "Media must contain 1-32 MiB"}
	}
	content := http.DetectContentType(data)
	ext := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm", "audio/mpeg": ".mp3", "audio/wave": ".wav", "audio/x-wav": ".wav"}[content]
	if ext == "" {
		return Detail{}, &apperr.ValidationError{Message: "Use PNG, JPEG, WebP, MP4, WebM, MP3, or WAV media"}
	}
	if strings.HasPrefix(content, "image/") && content != "image/webp" {
		cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width*cfg.Height > 16777216 {
			return Detail{}, &apperr.ValidationError{Message: "Invalid image dimensions"}
		}
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	id := uuid.NewSHA1(uuid.NameSpaceOID, []byte("media-upload:"+owner+":"+key)).String()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, owner+":"+key); err != nil {
		return Detail{}, err
	}
	if project != nil {
		var valid bool
		if err := tx.QueryRow(ctx, `SELECT true FROM projects WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL FOR SHARE`, project, owner).Scan(&valid); err != nil {
			return Detail{}, apperr.ErrNotFound
		}
	}
	var saved string
	var savedProject *string
	var deleted bool
	err = tx.QueryRow(ctx, `SELECT u.sha256,a.project_id::text,a.deleted_at IS NOT NULL FROM media_uploads u JOIN assets a ON a.id=u.asset_id AND a.owner_user_id=u.owner_user_id WHERE u.owner_user_id=$1 AND u.idempotency_key=$2 `, owner, key).Scan(&saved, &savedProject, &deleted)
	if err == nil {
		if deleted {
			return Detail{}, apperr.ErrNotFound
		}
		if saved != digest || !sameProject(savedProject, project) {
			return Detail{}, &apperr.ConflictError{Code: "idempotency_conflict", Message: "This upload key was used for different media"}
		}
		if err := tx.Commit(ctx); err != nil {
			return Detail{}, err
		}
		return NewService(s.pool).Get(ctx, owner, id)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Detail{}, err
	}
	info, err := s.files.Put(ctx, "uploads/"+owner+"/"+id+ext, bytes.NewReader(data))
	if err != nil {
		return Detail{}, err
	}
	kind := strings.Split(content, "/")[0]
	if _, err := tx.Exec(ctx, `INSERT INTO assets(id,owner_user_id,project_id,kind) VALUES($1,$2,$3,$4)`, id, owner, project, kind); err != nil {
		return Detail{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO asset_files(id,asset_id,role,storage_key,content_type,size_bytes) VALUES($1,$2,'original',$3,$4,$5)`, uuid.NewString(), id, info.Key, content, info.Size); err != nil {
		return Detail{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO media_uploads(owner_user_id,idempotency_key,sha256,asset_id) VALUES($1,$2,$3,$4)`, owner, key, digest, id); err != nil {
		return Detail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Detail{}, err
	}
	return NewService(s.pool).Get(ctx, owner, id)
}
func sameProject(a, b *string) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }
func (s *MediaService) Delete(ctx context.Context, owner, id string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var found bool
	if err := tx.QueryRow(ctx, `SELECT true FROM assets WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL FOR UPDATE`, id, owner).Scan(&found); err != nil {
		return apperr.ErrNotFound
	}
	var used bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM production_media WHERE asset_id=$1 AND owner_user_id=$2 UNION ALL SELECT 1 FROM character_image_versions WHERE asset_id=$1 AND owner_user_id=$2 UNION ALL SELECT 1 FROM reference_image_versions WHERE asset_id=$1 AND owner_user_id=$2 UNION ALL SELECT 1 FROM assets WHERE source_asset_id=$1 AND owner_user_id=$2 UNION ALL SELECT 1 FROM assets WHERE id=$1 AND owner_user_id=$2 AND producer_job_id IS NOT NULL UNION ALL SELECT 1 FROM jobs WHERE owner_user_id=$2 AND status IN ('queued','running') AND input_json::text LIKE '%'||$1::text||'%')`, id, owner).Scan(&used)
	if err != nil {
		return err
	}
	if used {
		return &apperr.ConflictError{Code: "asset_in_use", Message: "This media is retained by production history or an active job"}
	}
	if _, err := tx.Exec(ctx, `UPDATE assets SET deleted_at=now() WHERE id=$1 AND owner_user_id=$2`, id, owner); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO blob_deletions(storage_key,owner_user_id) SELECT f.storage_key,a.owner_user_id FROM asset_files f JOIN assets a ON a.id=f.asset_id WHERE a.id=$1 AND a.owner_user_id=$2 ON CONFLICT DO NOTHING`, id, owner); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *MediaService) Cleanup(ctx context.Context) error {
	deleter, ok := s.files.(interface {
		Delete(context.Context, string) error
	})
	if !ok {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT storage_key,owner_user_id::text FROM blob_deletions WHERE completed_at IS NULL ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED`)
	if err != nil {
		return err
	}
	type deletion struct{ key, owner string }
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (deletion, error) {
		var item deletion
		err := row.Scan(&item.key, &item.owner)
		return item, err
	})
	if err != nil {
		return err
	}
	for _, item := range items {
		if err := deleter.Delete(ctx, item.key); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE blob_deletions SET completed_at=now() WHERE storage_key=$1 AND owner_user_id=$2`, item.key, item.owner); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
