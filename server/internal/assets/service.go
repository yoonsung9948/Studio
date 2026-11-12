package assets

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"nori/studio/server/internal/platform/apperr"
)

type Asset struct {
	ID            string    `json:"id"`
	SourceAssetID *string   `json:"sourceAssetId"`
	ProjectID     *string   `json:"projectId"`
	ProducerJobID *string   `json:"producerJobId"`
	Kind          string    `json:"kind"`
	CreatedAt     time.Time `json:"createdAt"`
}
type File struct {
	ID          string `json:"id"`
	AssetID     string `json:"assetId"`
	Role        string `json:"role"`
	StorageKey  string `json:"-"`
	ContentType string `json:"contentType"`
	SizeBytes   int64  `json:"sizeBytes"`
}
type Detail struct {
	Asset
	Files []File `json:"files"`
}
type Page struct {
	Items      []Asset `json:"items"`
	NextCursor *string `json:"nextCursor"`
}
type ListParams struct {
	Kind      string
	Limit     int
	Cursor    string
	ProjectID *string
}
type cursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}
type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) Get(ctx context.Context, ownerID, id string) (Detail, error) {
	var d Detail
	err := s.pool.QueryRow(ctx, `SELECT id::text,project_id::text,producer_job_id::text,kind,created_at,source_asset_id::text FROM assets WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, id, ownerID).Scan(&d.ID, &d.ProjectID, &d.ProducerJobID, &d.Kind, &d.CreatedAt, &d.SourceAssetID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Detail{}, apperr.ErrNotFound
	}
	if err != nil {
		return Detail{}, err
	}
	rows, err := s.pool.Query(ctx, `SELECT f.id::text,f.asset_id::text,f.role,f.storage_key,f.content_type,f.size_bytes FROM asset_files f JOIN assets a ON a.id=f.asset_id WHERE a.id=$1 AND a.owner_user_id=$2 AND a.deleted_at IS NULL ORDER BY f.role`, id, ownerID)
	if err != nil {
		return Detail{}, err
	}
	d.Files, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (File, error) { return scanFile(row) })
	if d.Files == nil {
		d.Files = []File{}
	}
	return d, err
}
func (s *Service) List(ctx context.Context, ownerID string, p ListParams) (Page, error) {
	if p.Kind != "" && p.Kind != "image" && p.Kind != "video" && p.Kind != "audio" {
		return Page{}, &apperr.ValidationError{Message: "unsupported asset kind"}
	}
	if p.Limit == 0 {
		p.Limit = 20
	}
	if p.Limit < 1 || p.Limit > 100 {
		return Page{}, &apperr.ValidationError{Message: "limit must be between 1 and 100"}
	}
	var before *time.Time
	var id *string
	if len(p.Cursor) > 1024 {
		return Page{}, &apperr.ValidationError{Message: "invalid cursor"}
	}
	if p.Cursor != "" {
		var c cursor
		b, err := base64.RawURLEncoding.DecodeString(p.Cursor)
		if err != nil || json.Unmarshal(b, &c) != nil || c.CreatedAt.IsZero() {
			return Page{}, &apperr.ValidationError{Message: "invalid cursor"}
		}
		if _, err := uuid.Parse(c.ID); err != nil {
			return Page{}, &apperr.ValidationError{Message: "invalid cursor"}
		}
		before, id = &c.CreatedAt, &c.ID
	}
	if p.ProjectID != nil {
		if _, err := uuid.Parse(*p.ProjectID); err != nil {
			return Page{}, &apperr.ValidationError{Message: "invalid project ID"}
		}
		var owned bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL)`, p.ProjectID, ownerID).Scan(&owned); err != nil {
			return Page{}, err
		}
		if !owned {
			return Page{}, apperr.ErrNotFound
		}
	}
	rows, err := s.pool.Query(ctx, `SELECT id::text,project_id::text,producer_job_id::text,kind,created_at,source_asset_id::text FROM assets
 WHERE owner_user_id=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR project_id=$2) AND ($6='' OR kind=$6)
 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5`, ownerID, p.ProjectID, before, id, p.Limit+1, p.Kind)
	if err != nil {
		return Page{}, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Asset, error) {
		var a Asset
		err := row.Scan(&a.ID, &a.ProjectID, &a.ProducerJobID, &a.Kind, &a.CreatedAt, &a.SourceAssetID)
		return a, err
	})
	if err != nil {
		return Page{}, err
	}
	if items == nil {
		items = []Asset{}
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
func (s *Service) File(ctx context.Context, ownerID, fileID string) (File, error) {
	return ownedFile(s.pool.QueryRow(ctx, `SELECT f.id::text,f.asset_id::text,f.role,f.storage_key,f.content_type,f.size_bytes FROM asset_files f JOIN assets a ON a.id=f.asset_id JOIN users u ON u.id=a.owner_user_id WHERE f.id=$1 AND a.owner_user_id=$2 AND a.deleted_at IS NULL AND u.status='active'`, fileID, ownerID))
}
func (s *Service) FileByKey(ctx context.Context, ownerID, key string) (File, error) {
	return ownedFile(s.pool.QueryRow(ctx, `SELECT f.id::text,f.asset_id::text,f.role,f.storage_key,f.content_type,f.size_bytes FROM asset_files f JOIN assets a ON a.id=f.asset_id WHERE f.storage_key=$1 AND a.owner_user_id=$2 AND a.deleted_at IS NULL`, key, ownerID))
}
func ownedFile(row pgx.Row) (File, error) {
	f, err := scanFile(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return File{}, apperr.ErrNotFound
	}
	return f, err
}
func scanFile(row interface{ Scan(...any) error }) (File, error) {
	var f File
	err := row.Scan(&f.ID, &f.AssetID, &f.Role, &f.StorageKey, &f.ContentType, &f.SizeBytes)
	return f, err
}
