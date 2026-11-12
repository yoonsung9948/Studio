package characters

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type ListParams struct {
	Limit  int
	Cursor string
	Search string
	View   string
}

type Page[T any] struct {
	Items      []T     `json:"items"`
	NextCursor *string `json:"nextCursor"`
}

type cursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

func (p *ListParams) validate() (cursor, error) {
	if p.Limit == 0 {
		p.Limit = 20
	}
	if p.Limit < 1 || p.Limit > 100 {
		return cursor{}, invalid("limit must be between 1 and 100")
	}
	p.Search = strings.TrimSpace(p.Search)
	if !utf8.ValidString(p.Search) || utf8.RuneCountInString(p.Search) > 200 {
		return cursor{}, invalid("search must contain at most 200 characters")
	}
	if p.View != "" && !validView(p.View) {
		return cursor{}, invalid("unsupported character view")
	}
	if p.Cursor == "" {
		return cursor{}, nil
	}
	if len(p.Cursor) > 1024 {
		return cursor{}, invalid("invalid cursor")
	}
	raw, err := base64.RawURLEncoding.DecodeString(p.Cursor)
	var c cursor
	if err != nil || json.Unmarshal(raw, &c) != nil || c.CreatedAt.IsZero() {
		return cursor{}, invalid("invalid cursor")
	}
	id, err := uuid.Parse(c.ID)
	if err != nil {
		return cursor{}, invalid("invalid cursor")
	}
	c.ID = id.String()
	return c, nil
}

func nextCursor(c cursor) *string {
	raw, _ := json.Marshal(c)
	token := base64.RawURLEncoding.EncodeToString(raw)
	return &token
}

func (s *Service) List(ctx context.Context, owner string, p ListParams) (Page[Character], error) {
	c, err := p.validate()
	if err != nil {
		return Page[Character]{}, err
	}
	var before *time.Time
	var id *string
	if !c.CreatedAt.IsZero() {
		before, id = &c.CreatedAt, &c.ID
	}
	rows, err := s.pool.Query(ctx, `SELECT `+characterColumns+` FROM characters WHERE owner_user_id=$1 AND deleted_at IS NULL
 AND ($2::timestamptz IS NULL OR (created_at,id)<($2,$3::uuid)) AND ($4='' OR strpos(lower(name),lower($4))>0)
 ORDER BY created_at DESC,id DESC LIMIT $5`, owner, before, id, p.Search, p.Limit+1)
	if err != nil {
		return Page[Character]{}, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Character, error) { return scanCharacter(row) })
	if err != nil {
		return Page[Character]{}, err
	}
	if items == nil {
		items = []Character{}
	}
	page := Page[Character]{Items: items}
	if len(items) > p.Limit {
		page.Items = items[:p.Limit]
		last := page.Items[len(page.Items)-1]
		page.NextCursor = nextCursor(cursor{last.CreatedAt, last.ID})
	}
	return page, nil
}

func (s *Service) Versions(ctx context.Context, owner, id string, p ListParams) (Page[Version], error) {
	c, err := p.validate()
	if err != nil {
		return Page[Version]{}, err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Page[Version]{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := scanCharacter(tx.QueryRow(ctx, `SELECT `+characterColumns+` FROM characters WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, id, owner)); err != nil {
		return Page[Version]{}, err
	}
	var before *time.Time
	var lastID *string
	if !c.CreatedAt.IsZero() {
		before, lastID = &c.CreatedAt, &c.ID
	}
	rows, err := tx.Query(ctx, `SELECT v.id::text,v.character_id::text,v.view,v.asset_id::text,v.producer_job_id::text,v.appearance_revision,v.source_identity_version_id::text,v.prompt,v.approval,v.created_at,
 (v.appearance_revision<>c.appearance_revision OR (v.view<>'front' AND (v.source_identity_version_id IS DISTINCT FROM front.selected_version_id OR identity.appearance_revision IS DISTINCT FROM c.appearance_revision)))
 FROM character_image_versions v JOIN characters c ON c.id=v.character_id AND c.owner_user_id=v.owner_user_id
 LEFT JOIN character_views front ON front.character_id=c.id AND front.owner_user_id=c.owner_user_id AND front.view='front'
 LEFT JOIN character_image_versions identity ON identity.id=front.selected_version_id AND identity.owner_user_id=c.owner_user_id
 WHERE v.character_id=$1 AND v.owner_user_id=$2 AND c.deleted_at IS NULL AND ($3='' OR v.view=$3)
 AND ($4::timestamptz IS NULL OR (v.created_at,v.id)<($4,$5::uuid)) ORDER BY v.created_at DESC,v.id DESC LIMIT $6`, id, owner, p.View, before, lastID, p.Limit+1)
	if err != nil {
		return Page[Version]{}, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Version, error) {
		var v Version
		err := row.Scan(&v.ID, &v.CharacterID, &v.View, &v.AssetID, &v.ProducerJobID, &v.AppearanceRevision, &v.SourceIdentityVersionID, &v.Prompt, &v.Approval, &v.CreatedAt, &v.Stale)
		return v, err
	})
	if err != nil {
		return Page[Version]{}, err
	}
	if items == nil {
		items = []Version{}
	}
	page := Page[Version]{Items: items}
	if len(items) > p.Limit {
		page.Items = items[:p.Limit]
		last := page.Items[len(page.Items)-1]
		page.NextCursor = nextCursor(cursor{last.CreatedAt, last.ID})
	}
	return page, tx.Commit(ctx)
}
