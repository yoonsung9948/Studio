package project

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"nori/studio/server/internal/platform/apperr"
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

func (s *Service) Create(ctx context.Context, title string) (Project, error) {
	p := Project{ID: uuid.NewString(), Title: strings.TrimSpace(title)}
	if p.Title == "" || !utf8.ValidString(p.Title) || utf8.RuneCountInString(p.Title) > 200 {
		return Project{}, &apperr.ValidationError{Message: "title must contain 1–200 characters"}
	}
	err := s.pool.QueryRow(ctx, `INSERT INTO projects(id,title) VALUES($1,$2) RETURNING created_at`, p.ID, p.Title).Scan(&p.CreatedAt)
	return p, err
}
