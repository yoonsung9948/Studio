package billing

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"nori/studio/server/internal/platform/apperr"
)

type ListParams struct {
	Limit  int
	Cursor string
}

type Page[T any] struct {
	Items      []T     `json:"items"`
	NextCursor *string `json:"nextCursor"`
}

type cursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

func (p *ListParams) decode() (*time.Time, *string, error) {
	if p.Limit == 0 {
		p.Limit = 20
	}
	if p.Limit < 1 || p.Limit > 100 {
		return nil, nil, &apperr.ValidationError{Message: "limit must be between 1 and 100"}
	}
	if p.Cursor == "" {
		return nil, nil, nil
	}
	if len(p.Cursor) > 1024 {
		return nil, nil, &apperr.ValidationError{Message: "invalid cursor"}
	}
	raw, err := base64.RawURLEncoding.DecodeString(p.Cursor)
	var c cursor
	if err != nil || json.Unmarshal(raw, &c) != nil || c.CreatedAt.IsZero() {
		return nil, nil, &apperr.ValidationError{Message: "invalid cursor"}
	}
	if _, err := uuid.Parse(c.ID); err != nil {
		return nil, nil, &apperr.ValidationError{Message: "invalid cursor"}
	}
	return &c.CreatedAt, &c.ID, nil
}

func next(c cursor) *string {
	raw, _ := json.Marshal(c)
	value := base64.RawURLEncoding.EncodeToString(raw)
	return &value
}

func (s *Service) Purchases(ctx context.Context, owner string, p ListParams) (Page[Purchase], error) {
	before, id, err := p.decode()
	if err != nil {
		return Page[Purchase]{}, err
	}
	rows, err := s.pool.Query(ctx, `SELECT `+purchaseColumns+` FROM purchases WHERE owner_user_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4`, owner, before, id, p.Limit+1)
	if err != nil {
		return Page[Purchase]{}, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Purchase, error) { return scanPurchase(row) })
	if err != nil {
		return Page[Purchase]{}, err
	}
	if items == nil {
		items = []Purchase{}
	}
	page := Page[Purchase]{Items: items}
	if len(items) > p.Limit {
		page.Items = items[:p.Limit]
		last := page.Items[len(page.Items)-1]
		page.NextCursor = next(cursor{last.CreatedAt, last.ID})
	}
	return page, nil
}

func (s *Service) Entries(ctx context.Context, owner string, p ListParams) (Page[Entry], error) {
	before, id, err := p.decode()
	if err != nil {
		return Page[Entry]{}, err
	}
	rows, err := s.pool.Query(ctx, `SELECT id::text,kind,reference,available_delta,reserved_delta,available_after,reserved_after,created_at FROM credit_entries WHERE owner_user_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4`, owner, before, id, p.Limit+1)
	if err != nil {
		return Page[Entry]{}, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Entry, error) {
		var e Entry
		err := row.Scan(&e.ID, &e.Kind, &e.Reference, &e.AvailableDelta, &e.ReservedDelta, &e.AvailableAfter, &e.ReservedAfter, &e.CreatedAt)
		return e, err
	})
	if err != nil {
		return Page[Entry]{}, err
	}
	if items == nil {
		items = []Entry{}
	}
	page := Page[Entry]{Items: items}
	if len(items) > p.Limit {
		page.Items = items[:p.Limit]
		last := page.Items[len(page.Items)-1]
		page.NextCursor = next(cursor{last.CreatedAt, last.ID})
	}
	return page, nil
}
