package characters

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/platform/blob"
)

type Service struct {
	pool  *pgxpool.Pool
	jobs  *engine.JobService
	image engine.Operation
	store blob.Store
}

func NewService(pool *pgxpool.Pool, jobs *engine.JobService, image engine.Operation, store blob.Store) *Service {
	return &Service{pool: pool, jobs: jobs, image: image, store: store}
}

const characterColumns = "id::text,name,appearance,notes,appearance_revision,created_at,updated_at"

func scanCharacter(row pgx.Row) (Character, error) {
	var c Character
	err := row.Scan(&c.ID, &c.Name, &c.Appearance, &c.Notes, &c.AppearanceRevision, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		err = apperr.ErrNotFound
	}
	return c, err
}

func lockCharacter(ctx context.Context, tx pgx.Tx, owner, id string) (Character, error) {
	return scanCharacter(tx.QueryRow(ctx, `SELECT `+characterColumns+` FROM characters WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL FOR UPDATE`, id, owner))
}

func (s *Service) Create(ctx context.Context, owner string, in CreateInput) (Detail, error) {
	if err := in.normalize(); err != nil {
		return Detail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer tx.Rollback(ctx)
	c, err := scanCharacter(tx.QueryRow(ctx, `INSERT INTO characters(id,owner_user_id,name,appearance,notes) VALUES($1,$2,$3,$4,$5) RETURNING `+characterColumns, uuid.NewString(), owner, in.Name, in.Appearance, in.Notes))
	if err != nil {
		return Detail{}, err
	}
	detail := Detail{Character: c, Views: []View{}}
	for _, view := range views {
		if _, err := tx.Exec(ctx, `INSERT INTO character_views(character_id,owner_user_id,view) VALUES($1,$2,$3)`, c.ID, owner, view); err != nil {
			return Detail{}, err
		}
		detail.Views = append(detail.Views, View{Type: view})
	}
	return detail, tx.Commit(ctx)
}

func (s *Service) Get(ctx context.Context, owner, id string) (Detail, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Detail{}, err
	}
	defer tx.Rollback(ctx)
	c, err := scanCharacter(tx.QueryRow(ctx, `SELECT `+characterColumns+` FROM characters WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, id, owner))
	if err != nil {
		return Detail{}, err
	}
	rows, err := tx.Query(ctx, `SELECT cv.view,cv.selected_version_id::text,
 v.id IS NOT NULL AND (v.appearance_revision<>$3 OR (v.view<>'front' AND (v.source_identity_version_id IS DISTINCT FROM front.selected_version_id OR identity.appearance_revision IS DISTINCT FROM $3)))
 FROM character_views cv
 LEFT JOIN character_image_versions v ON v.id=cv.selected_version_id AND v.owner_user_id=cv.owner_user_id
 LEFT JOIN character_views front ON front.character_id=cv.character_id AND front.owner_user_id=cv.owner_user_id AND front.view='front'
 LEFT JOIN character_image_versions identity ON identity.id=front.selected_version_id AND identity.owner_user_id=cv.owner_user_id
 WHERE cv.character_id=$1 AND cv.owner_user_id=$2 ORDER BY array_position($4::text[],cv.view)`, id, owner, c.AppearanceRevision, views)
	if err != nil {
		return Detail{}, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (View, error) {
		var v View
		err := row.Scan(&v.Type, &v.SelectedVersionID, &v.Stale)
		return v, err
	})
	if err != nil {
		return Detail{}, err
	}
	d := Detail{Character: c, Views: items}
	for _, v := range items {
		if v.Type == "front" {
			d.CanonicalVersionID = v.SelectedVersionID
		}
	}
	return d, tx.Commit(ctx)
}

func (s *Service) Update(ctx context.Context, owner, id string, in UpdateInput) (Detail, error) {
	if in.Name == nil && in.Appearance == nil && in.Notes == nil {
		return Detail{}, invalid("provide at least one character field")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer tx.Rollback(ctx)
	current, err := lockCharacter(ctx, tx, owner, id)
	if err != nil {
		return Detail{}, err
	}
	next := CreateInput{Name: current.Name, Appearance: current.Appearance, Notes: current.Notes}
	if in.Name != nil {
		next.Name = *in.Name
	}
	if in.Appearance != nil {
		next.Appearance = *in.Appearance
	}
	if in.Notes != nil {
		next.Notes = *in.Notes
	}
	if err := next.normalize(); err != nil {
		return Detail{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE characters SET name=$3,notes=$4,appearance_revision=appearance_revision+CASE WHEN appearance<>$5 THEN 1 ELSE 0 END,appearance=$5,updated_at=now() WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, id, owner, next.Name, next.Notes, next.Appearance)
	if err != nil {
		return Detail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Detail{}, err
	}
	return s.Get(ctx, owner, id)
}

func (s *Service) Delete(ctx context.Context, owner, id string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE characters SET deleted_at=now(),updated_at=now() WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, id, owner)
	if err == nil && tag.RowsAffected() == 0 {
		return apperr.ErrNotFound
	}
	return err
}
