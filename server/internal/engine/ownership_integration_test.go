//go:build integration

package engine_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"nori/studio/server/internal/ownership"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/assets"
	projectdomain "nori/studio/server/internal/domain/project"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/engine/ops/video"
	"nori/studio/server/internal/httpapi"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/providers/fake"
	"nori/studio/server/internal/requests"
)

func secondOwner(t *testing.T, f *fixture) string {
	t.Helper()
	u, err := accounts.NewService(f.pool).Resolve(context.Background(), accounts.Identity{Issuer: "test", Subject: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(context.Background(), `INSERT INTO credit_wallets(owner_user_id,available) VALUES($1,1000000) ON CONFLICT DO NOTHING`, u.ID); err != nil {
		t.Fatal(err)
	}
	return u.ID
}
func TestOwnershipAndIdempotency(t *testing.T) {
	f := setup(t, fake.Interpreter{})
	ctx := context.Background()
	bob := secondOwner(t, f)
	project, err := f.projects.Create(ctx, f.owner, "Alice's film")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.projects.Get(ctx, bob, project.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("cross-owner project: %v", err)
	}
	projects, err := f.projects.List(ctx, bob, projectdomain.ListParams{})
	if err != nil || len(projects.Items) != 0 {
		t.Fatalf("project list: %+v %v", projects, err)
	}
	requestsService := requests.NewService(f.pool, f.service)
	a, err := requestsService.Submit(ctx, f.owner, "same-key", requests.Submission{Prompt: "Alice"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := requestsService.Submit(ctx, bob, "same-key", requests.Submission{Prompt: "Bob"})
	if err != nil {
		t.Fatal(err)
	}
	if a.Request.ID == b.Request.ID || a.Job.ID == b.Job.ID {
		t.Fatal("shared idempotency scope")
	}
	replay, err := requestsService.Submit(ctx, bob, "same-key", requests.Submission{Prompt: "Bob"})
	if err != nil || replay.Job.ID != b.Job.ID {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	if _, err := requestsService.Get(ctx, bob, a.Request.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("cross-owner request: %v", err)
	}
	if _, err := f.service.Get(ctx, bob, a.Job.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("cross-owner job: %v", err)
	}
	if _, err := requestsService.Submit(ctx, bob, "foreign-project", requests.Submission{Prompt: "Bob", ProjectID: &project.ID}); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("foreign project submission: %v", err)
	}
	if _, err := f.service.List(ctx, bob, engine.ListJobsParams{ProjectID: &project.ID}); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("foreign project filter: %v", err)
	}
	page, err := f.service.List(ctx, bob, engine.ListJobsParams{Limit: 1})
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != b.Job.ID || page.NextCursor != nil {
		t.Fatalf("job list: %+v %v", page, err)
	}
	// An uncommitted request by Alice must not block Bob using the same key.
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	input := engine.Submission{Operation: "interpret_request", Input: json.RawMessage(`{"prompt":"test"}`)}
	if _, err := f.service.SubmitTx(ctx, tx, f.owner, "concurrent-key", input); err != nil {
		t.Fatal(err)
	}
	deadline, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	if _, err := f.service.Submit(deadline, bob, "concurrent-key", input); err != nil {
		t.Fatalf("cross-owner lock contention: %v", err)
	}
	// Composite constraints reject mismatched owners even outside service code.
	_, err = f.pool.Exec(ctx, `UPDATE jobs SET project_id=$1 WHERE id=$2`, project.ID, b.Job.ID)
	if err == nil {
		t.Fatal("database allowed a cross-owner project link")
	}
}

func TestOwnedMediaAndSignedDownloads(t *testing.T) {
	ctx := context.Background()
	store, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	op := video.NewOperation(&fake.Video{Sample: []byte("0123456789")}, store, time.Millisecond)
	f := setup(t, fake.Interpreter{}, op)
	bob := secondOwner(t, f)
	f.start(t)
	job, err := f.service.Submit(ctx, f.owner, "video", engine.Submission{Operation: "generate_video", Input: json.RawMessage(`{"prompt":"A cafe","durationSeconds":6}`)})
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"assetId", "characterId", "referenceImageId"} {
		raw := json.RawMessage(`{"prompt":"A cafe","durationSeconds":6,"` + field + `":"` + uuid.NewString() + `"}`)
		if _, err := f.service.Submit(ctx, bob, "unsupported-"+field, engine.Submission{Operation: "generate_video", Input: raw}); err == nil {
			t.Fatalf("unsupported reference %s accepted", field)
		}
	}
	done := await(t, f, job.ID, "succeeded")
	if len(done.Results) != 1 || done.Results[0].AssetID == nil {
		t.Fatalf("no asset: %+v", done)
	}
	service := assets.NewService(f.pool)
	id := *done.Results[0].AssetID
	asset, err := service.Get(ctx, f.owner, id)
	if err != nil || len(asset.Files) != 1 || asset.ProjectID != nil || asset.ProducerJobID == nil || *asset.ProducerJobID != job.ID {
		t.Fatalf("asset: %+v %v", asset, err)
	}
	if _, err := service.Get(ctx, bob, id); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("cross-owner asset: %v", err)
	}
	if _, err := service.FileByKey(ctx, bob, asset.Files[0].StorageKey); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("cross-owner storage key: %v", err)
	}
	ownPage, err := service.List(ctx, f.owner, assets.ListParams{Kind: "image"})
	if err != nil || len(ownPage.Items) != 0 {
		t.Fatalf("kind filter=%+v err=%v", ownPage, err)
	}
	ownPage, err = service.List(ctx, f.owner, assets.ListParams{Kind: "video"})
	if err != nil || len(ownPage.Items) != 1 {
		t.Fatalf("kind filter=%+v err=%v", ownPage, err)
	}
	page, err := service.List(ctx, bob, assets.ListParams{})
	if err != nil || len(page.Items) != 0 {
		t.Fatalf("asset list: %+v %v", page, err)
	}
	// Every representation uses the same ownership boundary.
	for _, role := range []string{"thumbnail", "preview"} {
		key := "jobs/" + job.ID + "/" + role + ".mp4"
		if _, err := store.Put(ctx, key, strings.NewReader("preview")); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(ctx, `INSERT INTO asset_files(id,asset_id,role,storage_key,content_type,size_bytes) VALUES($1,$2,$3,$4,'video/mp4',7)`, uuid.NewString(), id, role, key); err != nil {
			t.Fatal(err)
		}
	}
	asset, err = service.Get(ctx, f.owner, id)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := httpapi.NewDownloadSigner([]byte(strings.Repeat("s", 32)))
	if err != nil {
		t.Fatal(err)
	}
	// Only the fixture authenticator can supply this verified identity.
	auth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			subject := req.Header.Get("X-Test-Subject")
			if subject == "" {
				w.WriteHeader(401)
				return
			}
			next.ServeHTTP(w, req.WithContext(accounts.WithIdentity(req.Context(), accounts.Identity{Issuer: "test", Subject: subject})))
		})
	}
	api := httpapi.New(httpapi.Services{Accounts: accounts.NewService(f.pool), Authenticate: auth, Assets: service, Files: store, Downloads: signer, Projects: f.projects, Jobs: f.service, Requests: requests.NewService(f.pool, f.service)}, slog.New(slog.NewTextHandler(io.Discard, nil)), f.pool.Ping)
	call := func(method, path, subject string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		if subject != "" {
			req.Header.Set("X-Test-Subject", subject)
		}
		w := httptest.NewRecorder()
		api.ServeHTTP(w, req)
		return w
	}
	if w := call("GET", "/api/v1/jobs?owner_user_id="+f.owner, "bob"); w.Code != 200 || strings.Contains(w.Body.String(), job.ID) {
		t.Fatalf("query owner override: %d %s", w.Code, w.Body)
	}
	reqOverride := httptest.NewRequest("POST", "/api/v1/requests", strings.NewReader(`{"prompt":"test","owner_user_id":"`+f.owner+`"}`))
	reqOverride.Header.Set("X-Test-Subject", "bob")
	reqOverride.Header.Set("Idempotency-Key", "override")
	override := httptest.NewRecorder()
	api.ServeHTTP(override, reqOverride)
	if override.Code != 400 {
		t.Fatalf("body owner override: %d %s", override.Code, override.Body)
	}
	for _, file := range asset.Files {
		path := "/api/v1/asset-files/" + file.ID + "/url"
		if w := call("GET", path, "bob"); w.Code != 404 {
			t.Fatalf("foreign %s URL: %d %s", file.Role, w.Code, w.Body)
		}
		w := call("GET", path, "default")
		if w.Code != 200 {
			t.Fatalf("download link: %d %s", w.Code, w.Body)
		}
		var link struct {
			URL string `json:"url"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &link); err != nil {
			t.Fatal(err)
		}
		if w := call("GET", link.URL, ""); w.Code != 200 {
			t.Fatalf("signed %s: %d %s", file.Role, w.Code, w.Body)
		}
		if w := call("GET", link.URL+"x", ""); w.Code != 404 {
			t.Fatalf("tampered URL: %d", w.Code)
		}
	}
	// Locate original explicitly; roles are returned in sorted order.
	original := asset.Files[0]
	for _, file := range asset.Files {
		if file.Role == "original" {
			original = file
		}
	}
	url, _ := signer.URL(f.owner, original.ID)
	req := httptest.NewRequest("GET", url, nil)
	req.Header.Set("Range", "bytes=2-5")
	w := httptest.NewRecorder()
	api.ServeHTTP(w, req)
	if w.Code != 206 || w.Body.String() != "2345" {
		t.Fatalf("range: %d %s", w.Code, w.Body)
	}
	if w := call("HEAD", url, ""); w.Code != 200 || w.Body.Len() != 0 {
		t.Fatalf("HEAD: %d %s", w.Code, w.Body)
	}
	if w := call("GET", "/api/v1/files/"+original.StorageKey, ""); w.Code != 401 {
		t.Fatalf("raw unauthenticated file: %d", w.Code)
	}
	if w := call("GET", "/api/v1/files/"+original.StorageKey, "bob"); w.Code != 404 {
		t.Fatalf("raw foreign file: %d", w.Code)
	}
	// Signed capabilities also stop working when the owner is disabled.
	if _, err := f.pool.Exec(ctx, `UPDATE users SET status='disabled' WHERE id=$1`, f.owner); err != nil {
		t.Fatal(err)
	}
	if w := call("GET", url, ""); w.Code != 404 {
		t.Fatalf("disabled owner media: %d", w.Code)
	}
}

func TestLegacyMigrationQuarantinesExistingData(t *testing.T) {
	f := setup(t, fake.Interpreter{})
	ctx := context.Background()
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `CREATE SCHEMA legacy_fixture; SET LOCAL search_path TO legacy_fixture`); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"001_core.sql", "002_steps.sql", "003_interpret_request.sql", "004_general_jobs.sql", "005_requests.sql", "006_accounts.sql"} {
		sql, err := os.ReadFile("../platform/db/migrations/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			t.Fatal(err)
		}
	}
	projectID, jobID, requestID, artifactID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	if _, err := tx.Exec(ctx, `INSERT INTO projects(id,title) VALUES($1,'Legacy film')`, projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO jobs(id,project_id,operation,input_schema_version,input_json,idempotency_key,river_job_id) VALUES($1,$2,'generate_video',1,'{}','legacy',1)`, jobID, projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO requests(id,project_id,prompt,idempotency_key,interpretation_job_id) VALUES($1,$2,'Legacy','legacy',$3)`, requestID, projectID, jobID); err != nil {
		t.Fatal(err)
	}
	content, _ := json.Marshal(map[string]any{"fileKey": "jobs/" + jobID + "/video.mp4", "contentType": "video/mp4", "sizeBytes": 10})
	if _, err := tx.Exec(ctx, `INSERT INTO artifacts(id,project_id,producer_job_id,kind,schema_version,content_json) VALUES($1,$2,$3,'video',1,$4)`, artifactID, projectID, jobID, content); err != nil {
		t.Fatal(err)
	}
	sql, err := os.ReadFile("../platform/db/migrations/007_ownership.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(sql)); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"projects", "requests", "jobs", "assets"} {
		var count int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE owner_user_id=$1", ownership.LegacyOwnerID).Scan(&count); err != nil || count != 1 {
			t.Fatalf("%s quarantined=%d err=%v", table, count, err)
		}
	}
	var disabled bool
	if err := tx.QueryRow(ctx, `SELECT status='disabled' FROM users WHERE id=$1`, ownership.LegacyOwnerID).Scan(&disabled); err != nil || !disabled {
		t.Fatalf("legacy disabled=%v err=%v", disabled, err)
	}
	var identities int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM auth_identities`).Scan(&identities); err != nil || identities != 0 {
		t.Fatal("legacy account acquired a login identity")
	}
}

func TestExplicitLegacyClaim(t *testing.T) {
	f := setup(t, fake.Interpreter{})
	ctx := context.Background()
	project, err := f.projects.Create(ctx, f.owner, "Legacy film")
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := requests.NewService(f.pool, f.service).Submit(ctx, f.owner, "legacy", requests.Submission{Prompt: "Legacy", ProjectID: &project.ID})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO users(id,status) VALUES($1,'disabled')`, ownership.LegacyOwnerID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SET CONSTRAINTS ALL DEFERRED`); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"projects", "jobs", "requests"} {
		if _, err := tx.Exec(ctx, "UPDATE "+table+" SET owner_user_id=$1 WHERE owner_user_id=$2", ownership.LegacyOwnerID, f.owner); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Get(ctx, f.owner, accepted.Job.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal("quarantined job accessible")
	}
	if err := ownership.ClaimLegacy(ctx, f.pool, uuid.NewString()); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("nonexistent target accepted: %v", err)
	}
	if err := ownership.ClaimLegacy(ctx, f.pool, f.owner); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Get(ctx, f.owner, accepted.Job.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.projects.Get(ctx, f.owner, project.ID); err != nil {
		t.Fatal(err)
	}
}
