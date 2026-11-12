//go:build integration

package engine_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/providers/fake"
	"nori/studio/server/internal/requests"
)

func TestRequestConcurrentReplayAndScopes(t *testing.T) {
	f := setup(t, fake.Interpreter{})
	service := requests.NewService(f.pool, f.service)
	ctx := context.Background()
	const n = 8
	results := make([]requests.Accepted, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], errs[i] = service.Submit(ctx, f.owner, "same", requests.Submission{Prompt: " A café "})
		}()
	}
	wg.Wait()
	for i := range n {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if results[i].Request.ID != results[0].Request.ID || results[i].Job.ID != results[0].Job.ID {
			t.Fatal("replay created new work")
		}
	}
	saved, err := service.Get(ctx, f.owner, results[0].Request.ID)
	if err != nil || saved.Prompt != "A café" || saved.InterpretationJobID != results[0].Job.ID {
		t.Fatalf("saved=%+v err=%v", saved, err)
	}
	if _, err := service.Submit(ctx, f.owner, "same", requests.Submission{Prompt: "Different"}); !errors.Is(err, engine.ErrIdempotencyConflict) {
		t.Fatalf("conflict=%v", err)
	}
	project, err := f.projects.Create(ctx, f.owner, "Film")
	if err != nil {
		t.Fatal(err)
	}
	linked, err := service.Submit(ctx, f.owner, "same", requests.Submission{Prompt: "A café", ProjectID: &project.ID})
	if err != nil || linked.Request.ID == saved.ID {
		t.Fatalf("project scope=%+v err=%v", linked, err)
	}
	for _, table := range []string{"requests", "jobs", "river_job"} {
		var count int
		if err := f.pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil || count != 2 {
			t.Fatalf("%s count=%d err=%v", table, count, err)
		}
	}
	if _, err := service.Get(ctx, f.owner, uuid.NewString()); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("missing=%v", err)
	}
}

func TestRequestFailureRollsBackEnqueue(t *testing.T) {
	f := setup(t, fake.Interpreter{})
	ctx := context.Background()
	// Fail after the job and River row have been inserted.
	_, err := f.pool.Exec(ctx, `CREATE FUNCTION reject_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'request insert failed'; END $$;
 CREATE TRIGGER reject_request BEFORE INSERT ON requests FOR EACH ROW EXECUTE FUNCTION reject_request();`)
	if err != nil {
		t.Fatal(err)
	}
	service := requests.NewService(f.pool, f.service)
	if _, err := service.Submit(ctx, f.owner, "first", requests.Submission{Prompt: "A café"}); err == nil {
		t.Fatal("expected insert failure")
	}
	for _, table := range []string{"requests", "jobs", "river_job"} {
		var count int
		if err := f.pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("%s count=%d err=%v", table, count, err)
		}
	}
}

func TestRequestValidationDoesNotSchedule(t *testing.T) {
	f := setup(t, fake.Interpreter{})
	service := requests.NewService(f.pool, f.service)
	ctx := context.Background()
	badID := "bad"
	missing := uuid.NewString()
	for _, tc := range []struct {
		key   string
		input requests.Submission
	}{
		{"", requests.Submission{Prompt: "A café"}},
		{"key", requests.Submission{Prompt: " "}},
		{"key", requests.Submission{Prompt: "A café", ProjectID: &badID}},
		{"key", requests.Submission{Prompt: "A café", ProjectID: &missing}},
	} {
		if _, err := service.Submit(ctx, f.owner, tc.key, tc.input); err == nil {
			t.Fatal("invalid request accepted")
		}
	}
	var count int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM jobs`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("count=%d err=%v", count, err)
	}
}
