//go:build integration

package openai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"nori/studio/server/internal/platform/db"
	"nori/studio/server/internal/providers"
)

func TestDurableSubmissionClaims(t *testing.T) {
	ctx := context.Background()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("TEST_DATABASE_URL is required; this test creates an isolated database")
	}
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := "studio_image_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+pgx.Identifier{name}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := admin.Exec(ctx, `DROP DATABASE `+pgx.Identifier{name}.Sanitize()+` WITH (FORCE)`); err != nil {
			t.Error(err)
		}
	}()
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.Database = name
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	for range 2 {
		if err := db.Migrate(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	owner, id := uuid.NewString(), uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id) VALUES($1)`, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO jobs(id,owner_user_id,operation,input_schema_version,input_json,idempotency_key,river_job_id) VALUES($1,$2,'generate_image',1,'{}','test',1)`, id, owner); err != nil {
		t.Fatal(err)
	}
	store := calls{pool}
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, err := store.Claim(ctx, id, "hash", DefaultImageModel)
			if err != nil && !errors.Is(err, providers.ErrUncertain) {
				t.Error(err)
			}
			if ok {
				accepted.Add(1)
			}
		}()
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatalf("accepted %d concurrent submissions", accepted.Load())
	}
	fresh := calls{pool}
	if _, err := fresh.Claim(ctx, id, "hash", DefaultImageModel); !errors.Is(err, providers.ErrUncertain) {
		t.Fatalf("pending submission replayed: %v", err)
	}
	for range 2 {
		if err := store.Record(ctx, id, "retryable", "req-limit", nil); err != nil {
			t.Fatal(err)
		}
		if _, err := fresh.Claim(ctx, id, "changed", DefaultImageModel); !errors.Is(err, providers.ErrUncertain) {
			t.Fatalf("changed input accepted: %v", err)
		}
		if ok, err := fresh.Claim(ctx, id, "hash", DefaultImageModel); err != nil || !ok {
			t.Fatalf("retry: %v", err)
		}
	}
	if err := store.Record(ctx, id, "retryable", "req-limit", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := fresh.Claim(ctx, id, "hash", DefaultImageModel); !errors.Is(err, providers.ErrQuota) {
		t.Fatalf("unbounded submissions: %v", err)
	}
	metadata := json.RawMessage(`{"usage":{"input_tokens":7}}`)
	if err := store.Record(ctx, id, "completed", "req-success", metadata); err != nil {
		t.Fatal(err)
	}
	var actual json.RawMessage
	var requestID string
	if err := pool.QueryRow(ctx, `SELECT metadata,request_id FROM image_provider_calls WHERE job_id=$1`, id).Scan(&actual, &requestID); err != nil {
		t.Fatal(err)
	}
	if requestID != "req-success" || !strings.Contains(string(actual), "input_tokens") {
		t.Fatalf("lost usage: %s %s", requestID, actual)
	}
}
