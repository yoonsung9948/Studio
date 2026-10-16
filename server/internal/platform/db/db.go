package db

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Open connects to PostgreSQL and verifies the connection.
// Errors never include the URL, which may contain a password.
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, errors.New("invalid DATABASE_URL")
	}
	config.MaxConns = 10
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, errors.New("cannot connect to PostgreSQL")
	}
	return pool, nil
}
