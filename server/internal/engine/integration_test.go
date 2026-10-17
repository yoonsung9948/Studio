//go:build integration

package engine_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"nori/studio/server/internal/domain/project"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/engine/ops/brief"
	"nori/studio/server/internal/engine/ops/video"
	"nori/studio/server/internal/httpapi"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/platform/db"
	"nori/studio/server/internal/platform/queue"
	"nori/studio/server/internal/providers/fake"
)

// testQueues serves every production queue with n workers each.
func testQueues(t *testing.T, n int) map[string]river.QueueConfig {
	t.Helper()
	queues, err := queue.Limits{LLM: n, Image: n, Video: n, Render: n}.Configs()
	if err != nil {
		t.Fatal(err)
	}
	return queues
}

type fixture struct {
	pool     *pgxpool.Pool
	queue    *river.Client[pgx.Tx]
	projects *project.Service
	service  *engine.JobService
	registry *engine.Registry
}

func newRegistry(t *testing.T, adapter brief.Interpreter, extra ...engine.Operation) *engine.Registry {
	t.Helper()
	registry, err := engine.NewRegistry(append([]engine.Operation{brief.NewOperation(adapter, brief.FakeProvider, brief.FakeModel)}, extra...)...)
	if err != nil {
		t.Fatal(err)
	}
	return registry
}

func setup(t *testing.T, adapter brief.Interpreter, extra ...engine.Operation) *fixture {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("TEST_DATABASE_URL must point to a local PostgreSQL database; tests create isolated databases")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	name := "studio_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+pgx.Identifier{name}.Sanitize()); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.Database = name
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, err := admin.Exec(ctx, `DROP DATABASE `+pgx.Identifier{name}.Sanitize()+` WITH (FORCE)`)
		admin.Close()
		if err != nil {
			t.Error(err)
		}
	})
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal("repeat migration:", err)
	}
	registry := newRegistry(t, adapter, extra...)
	workers := river.NewWorkers()
	river.AddWorker(workers, &engine.Worker{Pool: pool, Registry: registry})
	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Workers: workers, Queues: testQueues(t, 2),
		TestOnly: true, FetchCooldown: time.Millisecond, FetchPollInterval: 10 * time.Millisecond,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := client.StopAndCancel(ctx); err != nil {
			t.Error(err)
		}
	})
	return &fixture{pool: pool, queue: client, projects: project.NewService(pool), service: engine.NewJobService(pool, client, registry), registry: registry}
}

func (f *fixture) start(t *testing.T) {
	t.Helper()
	if err := f.queue.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func submit(t *testing.T, f *fixture, key string) engine.Job {
	t.Helper()
	return submitOperation(t, f, key, brief.Name, `{"prompt":"A woman discovers a letter in a café."}`)
}

func submitOperation(t *testing.T, f *fixture, key, operation, input string) engine.Job {
	t.Helper()
	proj, err := f.projects.Create(context.Background(), "Test film")
	if err != nil {
		t.Fatal(err)
	}
	job, err := f.service.Submit(context.Background(), proj.ID, key, engine.Submission{Operation: operation, Input: json.RawMessage(input)})
	if err != nil {
		t.Fatal(err)
	}
	return job
}

func await(t *testing.T, f *fixture, id, status string) engine.JobDetail {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		detail, err := f.service.Get(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if detail.Status == status {
			return detail
		}
		if detail.Status == "failed" {
			t.Fatalf("unexpected failure: %+v", detail)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("job did not become %s", status)
	return engine.JobDetail{}
}

func TestHTTPWorkflow(t *testing.T) {
	f := setup(t, brief.Fake{})
	f.start(t)
	server := httptest.NewServer(httpapi.New(httpapi.Services{Projects: f.projects, Jobs: f.service}, slog.Default(), f.pool.Ping))
	defer server.Close()
	post := func(path, body, key string) (int, []byte) {
		t.Helper()
		req, _ := http.NewRequest("POST", server.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", key)
		response, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, _ := io.ReadAll(response.Body)
		return response.StatusCode, data
	}
	status, body := post("/api/v1/projects", `{"title":"Film"}`, "")
	if status != 201 {
		t.Fatalf("project: %d %s", status, body)
	}
	var created project.Project
	if err := json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/projects/" + created.ID + "/jobs"
	request := `{"operation":"interpret_brief","input":{"prompt":"A café discovery."}}`
	status, body = post(path, request, "first")
	if status != 202 {
		t.Fatalf("submission: %d %s", status, body)
	}
	var job engine.Job
	if err := json.Unmarshal(body, &job); err != nil {
		t.Fatal(err)
	}
	done := await(t, f, job.ID, "succeeded")
	if len(done.Results) != 1 || done.Results[0].Kind != "creative_brief" || !bytes.Contains(done.Results[0].Content, []byte("A café discovery.")) {
		t.Fatalf("bad result: %+v", done)
	}
	if len(done.Attempts) != 1 || done.Attempts[0].Status != "succeeded" {
		t.Fatalf("bad attempts: %+v", done.Attempts)
	}
	response, err := server.Client().Get(server.URL + "/api/v1/jobs/" + job.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal(response.Status)
	}
	status, body = post(path, request, "first")
	if status != 202 || !bytes.Contains(body, []byte(job.ID)) {
		t.Fatalf("replay: %d %s", status, body)
	}
	status, _ = post(path, strings.Replace(request, "discovery", "meeting", 1), "first")
	if status != 409 {
		t.Fatalf("conflicting replay returned %d", status)
	}
	var queueName string
	if err := f.pool.QueryRow(context.Background(), `SELECT queue FROM river_job`).Scan(&queueName); err != nil || queueName != queue.LLM {
		t.Fatalf("job ran on queue %q, err=%v", queueName, err)
	}
	var count int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM generation_jobs`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("job count=%d err=%v", count, err)
	}
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM river_job`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("queue count=%d err=%v", count, err)
	}
}

func TestConcurrentIdempotency(t *testing.T) {
	f := setup(t, brief.Fake{})
	proj, err := f.projects.Create(context.Background(), "Film")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	ids := make(chan string, 12)
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			job, err := f.service.Submit(context.Background(), proj.ID, "same", engine.Submission{Operation: brief.Name, Input: json.RawMessage(`{"prompt":"story"}`)})
			if err != nil {
				t.Error(err)
				return
			}
			ids <- job.ID
		}()
	}
	wg.Wait()
	close(ids)
	var first string
	for id := range ids {
		if first == "" {
			first = id
		}
		if first != id {
			t.Fatal("duplicate job created")
		}
	}
}

func TestQueuedWorkSurvivesReconnect(t *testing.T) {
	f := setup(t, brief.Fake{})
	job := submit(t, f, "restart")
	config := f.pool.Config().Copy()
	other, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	service := engine.NewJobService(other, f.queue, f.registry)
	detail, err := service.Get(context.Background(), job.ID)
	other.Close()
	if err != nil || detail.Status != "queued" {
		t.Fatalf("persisted state: %+v %v", detail, err)
	}
	f.start(t)
	await(t, f, job.ID, "succeeded")
}

type invalidAdapter struct{}

func (invalidAdapter) Interpret(context.Context, brief.Input) (brief.Brief, error) {
	return brief.Brief{}, nil
}

func TestInvalidProviderOutput(t *testing.T) {
	f := setup(t, invalidAdapter{})
	job := submit(t, f, "invalid")
	f.start(t)
	done := await(t, f, job.ID, "failed")
	if len(done.Results) != 0 || done.Error == nil || done.Error.Code != "invalid_output" {
		t.Fatalf("bad failure: %+v", done)
	}
}

type transientAdapter struct{ calls atomic.Int32 }

func (a *transientAdapter) Interpret(ctx context.Context, in brief.Input) (brief.Brief, error) {
	if a.calls.Add(1) == 1 {
		return brief.Brief{}, errors.New("temporary failure")
	}
	return (brief.Fake{}).Interpret(ctx, in)
}

func TestRetryRetainsAttemptHistory(t *testing.T) {
	adapter := &transientAdapter{}
	f := setup(t, adapter)
	job := submit(t, f, "retry")
	f.start(t)
	done := await(t, f, job.ID, "succeeded")
	if len(done.Attempts) != 2 || done.Attempts[0].Status != "failed" || done.Attempts[1].Status != "succeeded" {
		t.Fatalf("attempts: %+v", done.Attempts)
	}
}

func TestSubmissionValidation(t *testing.T) {
	f := setup(t, brief.Fake{})
	proj, err := f.projects.Create(context.Background(), "Film")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ operation, input, key string }{
		{"unknown", `{"prompt":"story"}`, "one"},
		{brief.Name, `{"prompt":" "}`, "two"},
		{brief.Name, `{"prompt":"story","extra":true}`, "three"},
		{brief.Name, `{"prompt":"story"}`, ""},
	} {
		_, err := f.service.Submit(context.Background(), proj.ID, tc.key, engine.Submission{Operation: tc.operation, Input: json.RawMessage(tc.input)})
		var validation *apperr.ValidationError
		if !errors.As(err, &validation) {
			t.Fatalf("expected validation error, got %v", err)
		}
	}
	_, err = f.service.Submit(context.Background(), uuid.NewString(), "missing", engine.Submission{Operation: brief.Name, Input: json.RawMessage(`{"prompt":"story"}`)})
	if !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal(err)
	}
	var count int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM river_job`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("unexpected queued work: %d %v", count, err)
	}
}

type blockingAdapter struct{ started chan struct{} }

func (a blockingAdapter) Interpret(ctx context.Context, _ brief.Input) (brief.Brief, error) {
	close(a.started)
	<-ctx.Done()
	return brief.Brief{}, ctx.Err()
}

func TestRestartDuringExecution(t *testing.T) {
	started := make(chan struct{})
	f := setup(t, blockingAdapter{started: started})
	job := submit(t, f, "restart-running")
	f.start(t)
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not start")
	}
	stopCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := f.queue.StopAndCancel(stopCtx); err != nil {
		t.Fatal(err)
	}
	workers := river.NewWorkers()
	river.AddWorker(workers, &engine.Worker{Pool: f.pool, Registry: newRegistry(t, brief.Fake{})})
	next, err := river.NewClient(riverpgxv5.New(f.pool), &river.Config{
		Workers: workers, Queues: testQueues(t, 1), TestOnly: true,
		FetchCooldown: time.Millisecond, FetchPollInterval: 10 * time.Millisecond,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := next.StopAndCancel(ctx); err != nil {
			t.Error(err)
		}
	})
	if err := next.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	done := await(t, f, job.ID, "succeeded")
	if len(done.Attempts) != 2 || done.Attempts[0].Status != "failed" || done.Attempts[1].Status != "succeeded" {
		t.Fatalf("attempts: %+v", done.Attempts)
	}
}

func TestEnqueueRollsBackWithJob(t *testing.T) {
	f := setup(t, brief.Fake{})
	proj, err := f.projects.Create(context.Background(), "Film")
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.pool.Exec(context.Background(), `
 CREATE FUNCTION reject_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test insertion failure'; END $$;
 CREATE TRIGGER reject_job BEFORE INSERT ON generation_jobs FOR EACH ROW EXECUTE FUNCTION reject_job();`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.service.Submit(context.Background(), proj.ID, "rollback", engine.Submission{Operation: brief.Name, Input: json.RawMessage(`{"prompt":"story"}`)})
	if err == nil {
		t.Fatal("expected transaction failure")
	}
	var count int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM river_job`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("orphaned queue task: count=%d err=%v", count, err)
	}
}

func TestReconcileExhaustedCrash(t *testing.T) {
	f := setup(t, brief.Fake{})
	job := submit(t, f, "crash")
	_, err := f.pool.Exec(context.Background(), `
 UPDATE generation_jobs SET status='running',active_attempt=3 WHERE id=$1;
 `, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.pool.Exec(context.Background(), `INSERT INTO job_attempts(job_id,number,provider,model,status) VALUES($1,3,'fake_claude','fake-v1','running')`, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.pool.Exec(context.Background(), `UPDATE river_job SET state='discarded',finalized_at=now() WHERE id=(SELECT river_job_id FROM generation_jobs WHERE id=$1)`, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.service.Reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	done, err := f.service.Get(context.Background(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != "failed" || done.Error.Code != "execution_stopped" || done.Attempts[0].Status != "interrupted" {
		t.Fatalf("unreconciled job: %+v", done)
	}
	var persisted string
	if err := f.pool.QueryRow(context.Background(), `SELECT status FROM generation_jobs WHERE id=$1`, job.ID).Scan(&persisted); err != nil || persisted != "failed" {
		t.Fatalf("status=%s err=%v", persisted, err)
	}
}

// pipeline is a multi-step test operation: it starts on the llm queue, moves to
// render, polls twice with Wait, then publishes two artifacts.
type pipeline struct {
	firstSteps atomic.Int32
	failOnce   atomic.Bool // fail the final render step once, retryably
}

func (p *pipeline) Name() string                                             { return "test_pipeline" }
func (p *pipeline) InputVersion() int                                        { return 1 }
func (p *pipeline) Queue() string                                            { return queue.LLM }
func (p *pipeline) Provider() (string, string)                               { return "test", "test-v1" }
func (p *pipeline) Canonicalize(in json.RawMessage) (json.RawMessage, error) { return in, nil }

func (p *pipeline) Step(_ context.Context, run engine.Run) (engine.Outcome, error) {
	switch run.Step {
	case "":
		p.firstSteps.Add(1)
		return engine.Next{Step: "render", Queue: queue.Render, State: json.RawMessage(`{"polls":0}`)}, nil
	case "render":
		var state struct {
			Polls int `json:"polls"`
		}
		if err := json.Unmarshal(run.State, &state); err != nil {
			return nil, err
		}
		if state.Polls < 2 {
			return engine.Wait{State: json.RawMessage(fmt.Sprintf(`{"polls":%d}`, state.Polls+1))}, nil
		}
		if p.failOnce.CompareAndSwap(true, false) {
			return nil, &engine.RunError{Code: "provider_error", Message: "temporary", Retryable: true}
		}
		return engine.Done{Artifacts: []engine.ArtifactDraft{
			{Kind: "frame", SchemaVersion: 1, Content: json.RawMessage(`{"n":1}`)},
			{Kind: "frame", SchemaVersion: 1, Content: json.RawMessage(`{"n":2}`)},
		}}, nil
	}
	return nil, &engine.RunError{Code: "unknown_step", Message: run.Step}
}

func TestMultiStepOperation(t *testing.T) {
	op := &pipeline{}
	f := setup(t, brief.Fake{}, op)
	f.start(t)
	job := submitOperation(t, f, "pipeline", op.Name(), `{}`)
	done := await(t, f, job.ID, "succeeded")
	var order []int
	for _, r := range done.Results {
		var content struct{ N int }
		if err := json.Unmarshal(r.Content, &content); err != nil {
			t.Fatal(err)
		}
		order = append(order, content.N)
	}
	if fmt.Sprint(order) != "[1 2]" {
		t.Fatalf("results out of order: %+v", done.Results)
	}
	if done.Step != "render" || len(done.Attempts) != 1 || done.Attempts[0].Status != "succeeded" || op.firstSteps.Load() != 1 {
		t.Fatalf("step=%q attempts=%+v first steps=%d", done.Step, done.Attempts, op.firstSteps.Load())
	}
	rows, err := f.pool.Query(context.Background(), `SELECT queue,state::text FROM river_job ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	type riverRow struct{ Queue, State string }
	got, err := pgx.CollectRows(rows, pgx.RowToStructByPos[riverRow])
	if err != nil {
		t.Fatal(err)
	}
	want := []riverRow{{queue.LLM, "completed"}, {queue.Render, "completed"}}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("river jobs: %+v, want %+v", got, want)
	}
}

func TestRetryResumesFromCheckpoint(t *testing.T) {
	op := &pipeline{}
	op.failOnce.Store(true)
	f := setup(t, brief.Fake{}, op)
	f.start(t)
	job := submitOperation(t, f, "resume", op.Name(), `{}`)
	done := await(t, f, job.ID, "succeeded")
	if len(done.Attempts) != 2 || done.Attempts[0].Status != "failed" || done.Attempts[1].Status != "succeeded" {
		t.Fatalf("attempts: %+v", done.Attempts)
	}
	if op.firstSteps.Load() != 1 {
		t.Fatalf("first step ran %d times; the retry should resume at render", op.firstSteps.Load())
	}
	if len(done.Results) != 2 {
		t.Fatalf("results: %+v", done.Results)
	}
}

func TestGenerateVideo(t *testing.T) {
	store, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	op := video.NewOperation(&fake.Video{Delay: 100 * time.Millisecond, Sample: []byte("clip")}, store, 20*time.Millisecond)
	f := setup(t, brief.Fake{}, op)
	f.start(t)
	job := submitOperation(t, f, "video", video.Name, `{"prompt":"three small dogs dancing on a beach","durationSeconds":6}`)
	done := await(t, f, job.ID, "succeeded")
	if len(done.Results) != 1 || done.Results[0].Kind != "video" {
		t.Fatalf("results: %+v", done.Results)
	}
	var result video.Result
	if err := json.Unmarshal(done.Results[0].Content, &result); err != nil {
		t.Fatal(err)
	}
	if result.FileKey != "jobs/"+job.ID+"/video.mp4" || result.Resolution != "768P" || result.DurationSeconds != 6 {
		t.Fatalf("result: %+v", result)
	}
	file, err := store.Open(context.Background(), result.FileKey)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if data, _ := io.ReadAll(file); string(data) != "clip" {
		t.Fatalf("stored %q", data)
	}
	if len(done.Attempts) != 1 || done.Attempts[0].Status != "succeeded" || done.Attempts[0].Provider != "fake_minimax" {
		t.Fatalf("attempts: %+v", done.Attempts)
	}
	var queueName string
	if err := f.pool.QueryRow(context.Background(), `SELECT queue FROM river_job`).Scan(&queueName); err != nil || queueName != queue.Video {
		t.Fatalf("queue %q, err=%v", queueName, err)
	}
}
