package project

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"nori/studio/server/internal/platform/apperr"
	"strings"
	"time"
	"unicode/utf8"
)

type ListParams struct {
	Limit  int
	Cursor string
	Search string
}
type Page struct {
	Items      []Project `json:"items"`
	NextCursor *string   `json:"nextCursor"`
}
type cursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

func (s *Service) List(ctx context.Context, ownerID string, p ListParams) (Page, error) {
	if p.Limit == 0 {
		p.Limit = 20
	}
	if p.Limit < 1 || p.Limit > 100 {
		return Page{}, &apperr.ValidationError{Message: "limit must be between 1 and 100"}
	}
	p.Search = strings.TrimSpace(p.Search)
	if !utf8.ValidString(p.Search) || utf8.RuneCountInString(p.Search) > 200 {
		return Page{}, &apperr.ValidationError{Message: "search must contain at most 200 UTF-8 characters"}
	}
	if len(p.Cursor) > 1024 {
		return Page{}, &apperr.ValidationError{Message: "invalid cursor"}
	}
	var before *time.Time
	var id *string
	if p.Cursor != "" {
		var c cursor
		b, err := base64.RawURLEncoding.DecodeString(p.Cursor)
		if err != nil || json.Unmarshal(b, &c) != nil || c.CreatedAt.IsZero() {
			return Page{}, &apperr.ValidationError{Message: "invalid cursor"}
		}
		parsed, err := uuid.Parse(c.ID)
		if err != nil {
			return Page{}, &apperr.ValidationError{Message: "invalid cursor"}
		}
		c.ID = parsed.String()
		before, id = &c.CreatedAt, &c.ID
	}
	rows, err := s.pool.Query(ctx, `SELECT id::text,title,created_at FROM projects
 WHERE owner_user_id=$1 AND deleted_at IS NULL AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))
 AND ($4='' OR strpos(lower(title),lower($4))>0) ORDER BY created_at DESC,id DESC LIMIT $5`, ownerID, before, id, p.Search, p.Limit+1)
	if err != nil {
		return Page{}, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Project, error) {
		var p Project
		err := row.Scan(&p.ID, &p.Title, &p.CreatedAt)
		return p, err
	})
	if err != nil {
		return Page{}, err
	}
	if items == nil {
		items = []Project{}
	}
	page := Page{Items: items}
	if len(items) > p.Limit {
		page.Items = items[:p.Limit]
		last := page.Items[len(page.Items)-1]
		b, err := json.Marshal(cursor{last.CreatedAt, last.ID})
		if err != nil {
			return Page{}, err
		}
		token := base64.RawURLEncoding.EncodeToString(b)
		page.NextCursor = &token
	}
	return page, nil
}
