// Package app is the composition root: it builds every component from
// Config and connects them. It is the only package that sees all concrete types.
package app

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"nori/studio/server/internal/platform/db"
)

type App struct {
	cfg    Config
	logger *slog.Logger
	pool   *pgxpool.Pool
}

// New connects to the database. Call Close when done.
func New(ctx context.Context, cfg Config, logger *slog.Logger) (*App, error) {
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	return &App{cfg: cfg, logger: logger, pool: pool}, nil
}

func (a *App) Close() {
	a.pool.Close()
}

func (a *App) Migrate(ctx context.Context) error {
	return db.Migrate(ctx, a.pool)
}
