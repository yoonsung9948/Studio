package characters

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"nori/studio/server/internal/engine"
)

const MaxUploadBytes = 5 << 20

// Upload creates a front candidate; selecting it remains a separate request.
func (s *Service) Upload(ctx context.Context, owner, id, key string, reader io.Reader) (Version, error) {
	if key == "" || len(key) > 200 || strings.TrimSpace(key) != key {
		return Version{}, invalid("Idempotency-Key must contain 1-200 bytes without surrounding whitespace")
	}
	data, err := io.ReadAll(io.LimitReader(reader, MaxUploadBytes+1))
	if err != nil {
		return Version{}, err
	}
	contentType, extension, err := uploadFormat(data)
	if err != nil {
		return Version{}, err
	}
	hash := sha256.Sum256(data)
	digest := hex.EncodeToString(hash[:])
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Version{}, err
	}
	defer tx.Rollback(ctx)
	character, err := lockCharacter(ctx, tx, owner, id)
	if err != nil {
		return Version{}, err
	}
	var existing Version
	var savedHash string
	err = tx.QueryRow(ctx, `SELECT id::text,asset_id::text,appearance_revision,prompt,approval,created_at,upload_sha256 FROM character_image_versions WHERE character_id=$1 AND owner_user_id=$2 AND upload_key=$3`, id, owner, key).Scan(&existing.ID, &existing.AssetID, &existing.AppearanceRevision, &existing.Prompt, &existing.Approval, &existing.CreatedAt, &savedHash)
	if err == nil {
		if savedHash != digest {
			return Version{}, engine.ErrIdempotencyConflict
		}
		existing.CharacterID, existing.View = id, "front"
		existing.Stale = existing.AppearanceRevision != character.AppearanceRevision
		return existing, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Version{}, err
	}
	assetID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("character-upload:"+owner+":"+id+":"+key)).String()
	fileKey := "characters/" + id + "/uploads/" + assetID + extension
	info, err := s.store.Put(ctx, fileKey, bytes.NewReader(data))
	if err != nil {
		return Version{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO assets(id,owner_user_id,kind) VALUES($1,$2,'image')`, assetID, owner); err != nil {
		return Version{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO asset_files(id,asset_id,role,storage_key,content_type,size_bytes) VALUES($1,$2,'original',$3,$4,$5)`, uuid.NewString(), assetID, info.Key, contentType, info.Size); err != nil {
		return Version{}, err
	}
	version := Version{ID: uuid.NewString(), CharacterID: id, View: "front", AssetID: assetID, AppearanceRevision: character.AppearanceRevision, Prompt: "Uploaded character identity reference", Approval: "needs_review"}
	err = tx.QueryRow(ctx, `INSERT INTO character_image_versions(id,character_id,owner_user_id,view,asset_id,appearance_revision,prompt,upload_key,upload_sha256) VALUES($1,$2,$3,'front',$4,$5,$6,$7,$8) RETURNING created_at`, version.ID, id, owner, assetID, character.AppearanceRevision, version.Prompt, key, digest).Scan(&version.CreatedAt)
	if err != nil {
		return Version{}, err
	}
	return version, tx.Commit(ctx)
}

func uploadFormat(data []byte) (string, string, error) {
	if len(data) == 0 || len(data) > MaxUploadBytes {
		return "", "", invalid("choose an image of up to 5 MiB")
	}
	contentType := http.DetectContentType(data)
	extension := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[contentType]
	if extension == "" {
		return "", "", invalid("upload must be a PNG, JPEG, or WebP image")
	}
	if contentType != "image/webp" {
		config, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 8192 || config.Height > 8192 || config.Width*config.Height > 16_777_216 {
			return "", "", invalid("unsupported image dimensions or invalid image")
		}
	} else if len(data) < 30 {
		return "", "", invalid("invalid WebP image")
	}
	return contentType, extension, nil
}
