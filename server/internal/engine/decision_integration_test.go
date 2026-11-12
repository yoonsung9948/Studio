//go:build integration

package engine_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/domain/interpretation"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/engine/ops/video"
	"nori/studio/server/internal/httpapi"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/providers/fake"
	"nori/studio/server/internal/requests"
)

func TestInterpretationProposesWithoutExecuting(t *testing.T) {
	ctx := context.Background()
	files, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	generation := video.NewOperation(&fake.Video{Sample: []byte("clip")}, files, time.Millisecond)
	f := setup(t, fake.Interpreter{}, generation)
	f.start(t)
	api := httpapi.New(httpapi.Services{Accounts: accounts.NewService(f.pool), Authenticate: fixtureAuthentication, Projects: f.projects, Jobs: f.service, Requests: requests.NewService(f.pool, f.service)}, slog.Default(), f.pool.Ping)
	req := httptest.NewRequest("POST", "/api/v1/requests", strings.NewReader(`{"prompt":"A café in the rain"}`))
	req.Header.Set("Idempotency-Key", "interpret")
	w := httptest.NewRecorder()
	api.ServeHTTP(w, req)
	var accepted requests.Accepted
	if w.Code != 202 || json.Unmarshal(w.Body.Bytes(), &accepted) != nil {
		t.Fatalf("submit %d %s", w.Code, w.Body)
	}
	job := accepted.Job
	read := httptest.NewRecorder()
	api.ServeHTTP(read, httptest.NewRequest("GET", "/api/v1/requests/"+accepted.Request.ID, nil))
	var saved requests.Request
	if read.Code != 200 || json.Unmarshal(read.Body.Bytes(), &saved) != nil || saved.InterpretationJobID != job.ID {
		t.Fatalf("request read %d %s", read.Code, read.Body)
	}
	done := await(t, f, job.ID, "succeeded")
	if len(done.Results) != 1 || done.Results[0].Kind != "request_interpretation" || done.Results[0].SchemaVersion != 2 {
		t.Fatalf("result %+v", done.Results)
	}
	var decision interpretation.Decision
	if err := json.Unmarshal(done.Results[0].Content, &decision); err != nil {
		t.Fatal(err)
	}
	if err := decision.Validate(); err != nil {
		t.Fatal(err)
	}
	if decision.Action != interpretation.ProposeOperation || decision.Operation != "generate_video" {
		t.Fatalf("decision %+v", decision)
	}
	var count int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM jobs`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("interpretation scheduled another job: count=%d err=%v", count, err)
	}
	var queue string
	if err := f.pool.QueryRow(ctx, `SELECT queue FROM river_job WHERE id=(SELECT river_job_id FROM jobs WHERE id=$1)`, job.ID).Scan(&queue); err != nil || queue != "llm" {
		t.Fatalf("queue=%s err=%v", queue, err)
	}
	// Independent generation still requires an explicit submission.
	generated, err := f.service.Submit(ctx, f.owner, "manual-video", engine.Submission{Operation: decision.Operation, Input: decision.Input})
	if err != nil {
		t.Fatal(err)
	}
	result := await(t, f, generated.ID, "succeeded")
	if len(result.Results) != 1 || result.Results[0].Kind != "video" {
		t.Fatalf("independent generation %+v", result.Results)
	}
}
