package project

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"strings"
	"time"
	"unicode/utf8"

	"nori/studio/server/internal/platform/apperr"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Project struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Create(ctx context.Context, ownerID, title string) (Project, error) {
	p := Project{ID: uuid.NewString(), Title: strings.TrimSpace(title)}
	if p.Title == "" || !utf8.ValidString(p.Title) || utf8.RuneCountInString(p.Title) > 200 {
		return Project{}, &apperr.ValidationError{Message: "title must contain 1–200 characters"}
	}
	err := s.pool.QueryRow(ctx, `INSERT INTO projects(id,title,owner_user_id) VALUES($1,$2,$3) RETURNING created_at`, p.ID, p.Title, ownerID).Scan(&p.CreatedAt)
	return p, err
}

func (s *Service) Get(ctx context.Context, ownerID, id string) (Project, error) {
	var p Project
	err := s.pool.QueryRow(ctx, `SELECT id, title, created_at FROM projects WHERE id = $1 AND owner_user_id=$2 AND deleted_at IS NULL`, id, ownerID).Scan(&p.ID, &p.Title, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Project{}, apperr.ErrNotFound
	}
	return p, err
}
