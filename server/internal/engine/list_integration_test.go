//go:build integration

package engine_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/httpapi"
	"nori/studio/server/internal/platform/queue"
	"nori/studio/server/internal/providers/fake"
	"nori/studio/server/internal/requests"
)

type localOperation struct{ queue string }

func (o localOperation) Name() string                                           { return "local_" + o.queue }
func (o localOperation) Queue() string                                          { return o.queue }
func (localOperation) InputVersion() int                                        { return 1 }
func (localOperation) Canonicalize(in json.RawMessage) (json.RawMessage, error) { return in, nil }
func (localOperation) Step(context.Context, engine.Run) (engine.Outcome, error) {
	return engine.Done{}, nil
}

func TestJobPagesAcrossQueuesAndStandaloneExecution(t *testing.T) {
	f := setup(t, fake.Interpreter{}, localOperation{queue.LLM}, localOperation{queue.Image}, localOperation{queue.Video}, localOperation{queue.Render})
	ctx := context.Background()
	empty, err := f.service.List(ctx, f.owner, engine.ListJobsParams{})
	if err != nil || empty.Items == nil || len(empty.Items) != 0 || empty.NextCursor != nil {
		t.Fatalf("empty=%+v err=%v", empty, err)
	}
	var ids []string
	var standalone engine.Job
	for _, q := range queue.Names {
		j, err := f.service.Submit(ctx, f.owner, q, engine.Submission{Operation: "local_" + q, Input: json.RawMessage(`{}`)})
		if err != nil {
			t.Fatal(err)
		}
		if j.ProjectID != nil {
			t.Fatal("standalone job acquired a project")
		}
		ids = append(ids, j.ID)
		standalone = j
	}
	projectJob := submit(t, f, "project")
	ids = append(ids, projectJob.ID)
	tied := time.Date(2025, 1, 1, 0, 0, 0, 123456000, time.UTC)
	if _, err := f.pool.Exec(ctx, `UPDATE jobs SET created_at=$1`, tied); err != nil {
		t.Fatal(err)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(ids)))
	page, err := f.service.List(ctx, f.owner, engine.ListJobsParams{Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, j := range page.Items {
		got = append(got, j.ID)
		if j.Status != "queued" || len(j.Input) != 0 {
			t.Fatalf("unexpected summary %+v", j)
		}
	}
	// A newly inserted job must not shift subsequent pages.
	later, err := f.service.Submit(ctx, f.owner, "later", engine.Submission{Operation: "interpret_request", Input: json.RawMessage(`{"prompt":"later"}`)})
	if err != nil {
		t.Fatal(err)
	}
	for page.NextCursor != nil {
		page, err = f.service.List(ctx, f.owner, engine.ListJobsParams{Limit: 2, Cursor: *page.NextCursor})
		if err != nil {
			t.Fatal(err)
		}
		for _, j := range page.Items {
			got = append(got, j.ID)
		}
	}
	if strings.Join(got, ",") != strings.Join(ids, ",") {
		t.Fatalf("got %v want %v", got, ids)
	}
	filtered, err := f.service.List(ctx, f.owner, engine.ListJobsParams{ProjectID: projectJob.ProjectID})
	if err != nil || len(filtered.Items) != 1 || filtered.Items[0].ID != projectJob.ID {
		t.Fatalf("project filter %+v %v", filtered, err)
	}
	filtered, err = f.service.List(ctx, f.owner, engine.ListJobsParams{Operation: "local_render", Status: "queued"})
	if err != nil || len(filtered.Items) != 1 {
		t.Fatalf("operation filter %+v %v", filtered, err)
	}
	f.start(t)
	done := await(t, f, standalone.ID, "succeeded")
	if done.ProjectID != nil || len(done.Results) != 0 || len(done.Attempts) != 1 || done.Attempts[0].Provider != nil || done.Attempts[0].Model != nil {
		t.Fatalf("local job %+v", done)
	}
	generated := await(t, f, later.ID, "succeeded")
	if len(generated.Results) != 1 {
		t.Fatalf("standalone artifacts %+v", generated)
	}
	var projectID *string
	if err := f.pool.QueryRow(ctx, `SELECT project_id::text FROM artifacts WHERE producer_job_id=$1`, later.ID).Scan(&projectID); err != nil || projectID != nil {
		t.Fatalf("artifact project %v err=%v", projectID, err)
	}
}

func TestStandaloneConcurrentIdempotency(t *testing.T) {
	f := setup(t, fake.Interpreter{})
	ctx := context.Background()
	submission := engine.Submission{Operation: "interpret_request", Input: json.RawMessage(`{"prompt":"story"}`)}
	ids := make(chan string, 10)
	errs := make(chan error, 10)
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			j, err := f.service.Submit(ctx, f.owner, "same", submission)
			if err != nil {
				errs <- err
				return
			}
			ids <- j.ID
		}()
	}
	wg.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	id := ""
	for next := range ids {
		if id != "" && next != id {
			t.Fatal("duplicate jobs")
		}
		id = next
	}
	changed := submission
	changed.Input = json.RawMessage(`{"prompt":"different"}`)
	if _, err := f.service.Submit(ctx, f.owner, "same", changed); !errors.Is(err, engine.ErrIdempotencyConflict) {
		t.Fatalf("conflict %v", err)
	}
	// The same key remains valid in a separate project scope.
	project, err := f.projects.Create(ctx, f.owner, "Film")
	if err != nil {
		t.Fatal(err)
	}
	submission.ProjectID = &project.ID
	if _, err := f.service.Submit(ctx, f.owner, "same", submission); err != nil {
		t.Fatal(err)
	}
}

func TestJobsHTTPValidationAndProjectReads(t *testing.T) {
	f := setup(t, fake.Interpreter{})
	api := httpapi.New(httpapi.Services{Accounts: accounts.NewService(f.pool), Authenticate: fixtureAuthentication, Projects: f.projects, Jobs: f.service, Requests: requests.NewService(f.pool, f.service)}, slog.Default(), f.pool.Ping)
	for _, q := range []string{"limit=0", "limit=-1", "limit=101", "limit=no", "limit=", "cursor=!", "projectId=bad", "projectId=", "status=bad"} {
		w := httptest.NewRecorder()
		api.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/jobs?"+q, nil))
		if w.Code != 400 {
			t.Fatalf("%s => %d %s", q, w.Code, w.Body)
		}
	}
	for _, body := range []string{`{"projectId":"bad","prompt":"story"}`, `{"projectId":"","prompt":"story"}`} {
		req := httptest.NewRequest("POST", "/api/v1/requests", strings.NewReader(body))
		req.Header.Set("Idempotency-Key", "test")
		w := httptest.NewRecorder()
		api.ServeHTTP(w, req)
		if w.Code != 400 {
			t.Fatalf("invalid submission %d %s", w.Code, w.Body)
		}
	}
	for i, project := range []string{"", `"projectId":null,`} {
		req := httptest.NewRequest("POST", "/api/v1/requests", strings.NewReader(`{`+project+`"prompt":"story"}`))
		req.Header.Set("Idempotency-Key", fmt.Sprint(i))
		w := httptest.NewRecorder()
		api.ServeHTTP(w, req)
		if w.Code != 202 {
			t.Fatalf("standalone submission %d %s", w.Code, w.Body)
		}
	}
	w := httptest.NewRecorder()
	api.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/jobs?limit=1", nil))
	var page engine.JobPage
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil || w.Code != 200 || len(page.Items) != 1 || page.NextCursor == nil {
		t.Fatalf("page %d %s err=%v", w.Code, w.Body, err)
	}
	w = httptest.NewRecorder()
	api.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/jobs?limit=1&cursor="+*page.NextCursor, nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"nextCursor":null`) {
		t.Fatalf("last page %d %s", w.Code, w.Body)
	}
	w = httptest.NewRecorder()
	api.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+uuid.NewString(), nil))
	if w.Code != 404 {
		t.Fatalf("missing project %d %s", w.Code, w.Body)
	}
	w = httptest.NewRecorder()
	api.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil))
	var projects struct {
		Items      []json.RawMessage `json:"items"`
		NextCursor *string           `json:"nextCursor"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &projects); err != nil || w.Code != 200 || projects.Items == nil || len(projects.Items) != 0 || projects.NextCursor != nil {
		t.Fatalf("empty projects %d %s", w.Code, w.Body)
	}
}
