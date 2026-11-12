package characters

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"nori/studio/server/internal/platform/apperr"
)

func (s *Service) Select(ctx context.Context, owner, id, view, versionID string) (Detail, error) {
	if !validView(view) {
		return Detail{}, invalid("unsupported character view")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer tx.Rollback(ctx)
	character, err := lockCharacter(ctx, tx, owner, id)
	if err != nil {
		return Detail{}, err
	}
	var revision int
	var source *string
	var approval string
	err = tx.QueryRow(ctx, `SELECT v.appearance_revision,v.source_identity_version_id::text,v.approval FROM character_image_versions v JOIN assets a ON a.id=v.asset_id AND a.owner_user_id=v.owner_user_id JOIN asset_files f ON f.asset_id=a.id AND f.role='original' WHERE v.id=$1 AND v.character_id=$2 AND v.view=$3 AND v.owner_user_id=$4 AND a.kind='image'`, versionID, id, view, owner).Scan(&revision, &source, &approval)
	if errors.Is(err, pgx.ErrNoRows) {
		return Detail{}, apperr.ErrNotFound
	}
	if err != nil {
		return Detail{}, err
	}
	if approval == "rejected" {
		return Detail{}, conflict("candidate_rejected", "This candidate was rejected.")
	}
	if revision != character.AppearanceRevision {
		return Detail{}, conflict("stale_candidate", "The character appearance changed. Generate a current candidate.")
	}
	if view != "front" {
		selected, _, err := identity(ctx, tx, owner, id, character.AppearanceRevision)
		if err != nil {
			return Detail{}, err
		}
		if source == nil || *source != selected {
			return Detail{}, conflict("stale_candidate", "The canonical identity changed. Generate a new view.")
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE character_image_versions SET approval='approved' WHERE id=$1 AND character_id=$2 AND owner_user_id=$3`, versionID, id, owner); err != nil {
		return Detail{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE character_views SET selected_version_id=$3 WHERE character_id=$1 AND owner_user_id=$2 AND view=$4`, id, owner, versionID, view); err != nil {
		return Detail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Detail{}, err
	}
	return s.Get(ctx, owner, id)
}

func (s *Service) Reject(ctx context.Context, owner, id, versionID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := lockCharacter(ctx, tx, owner, id); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE character_image_versions SET approval='rejected' WHERE id=$1 AND character_id=$2 AND owner_user_id=$3`, versionID, id, owner)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.ErrNotFound
	}
	if _, err := tx.Exec(ctx, `UPDATE character_views SET selected_version_id=NULL WHERE character_id=$1 AND owner_user_id=$2 AND selected_version_id=$3`, id, owner, versionID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
