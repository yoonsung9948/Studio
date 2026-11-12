//go:build integration

package engine_test

import (
	"context"
	"encoding/json"
	"errors"
	"image/png"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/assets"
	"nori/studio/server/internal/engine"
	imageop "nori/studio/server/internal/engine/ops/image"
	"nori/studio/server/internal/httpapi"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/providers/fake"
)

type imageAssetReader struct{ service *assets.Service }

func (r *imageAssetReader) Get(ctx context.Context, owner, id string) (assets.Detail, error) {
	return r.service.Get(ctx, owner, id)
}

func TestImageGenerationAndEditingHTTP(t *testing.T) {
	ctx := context.Background()
	store, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	reader := &imageAssetReader{}
	f := setup(t, fake.Interpreter{}, imageop.NewGenerate(fake.Image{}, store, reader), imageop.NewEdit(fake.Image{}, store, reader))
	reader.service = assets.NewService(f.pool)
	bob := secondOwner(t, f)
	signer, err := httpapi.NewDownloadSigner([]byte(strings.Repeat("x", 32)))
	if err != nil {
		t.Fatal(err)
	}
	api := httpapi.New(httpapi.Services{Accounts: accounts.NewService(f.pool), Authenticate: fixtureAuthentication, Jobs: f.service, Images: f.service, Assets: reader.service, Files: store, Downloads: signer}, slog.New(slog.NewTextHandler(io.Discard, nil)), f.pool.Ping)
	post := func(path, key, body string) (engine.Job, int) {
		t.Helper()
		req := httptest.NewRequest("POST", "/api/v1/images/"+path, strings.NewReader(body))
		req.Header.Set("Idempotency-Key", key)
		response := httptest.NewRecorder()
		api.ServeHTTP(response, req)
		if response.Code != 202 {
			return engine.Job{}, response.Code
		}
		var accepted struct {
			Job engine.Job `json:"job"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &accepted); err != nil {
			t.Fatal(err)
		}
		if response.Header().Get("Location") != "/api/v1/jobs/"+accepted.Job.ID {
			t.Fatal("missing job location")
		}
		return accepted.Job, response.Code
	}
	body := `{"prompt":"a quiet cafe","settings":{"aspectRatio":"16:9"}}`
	first, status := post("generations", "first-image", body)
	if status != 202 || first.ProjectID != nil {
		t.Fatalf("generation: %d %+v", status, first)
	}
	replay, status := post("generations", "first-image", body)
	if status != 202 || replay.ID != first.ID {
		t.Fatal("idempotent submission created another job")
	}
	if _, status := post("generations", "first-image", `{"prompt":"a different cafe"}`); status != 409 {
		t.Fatalf("conflict: %d", status)
	}
	if _, status := post("generations", "", body); status != 400 {
		t.Fatalf("missing key: %d", status)
	}
	if _, status := post("generations", "bad-model", `{"prompt":"cafe","model":"unknown"}`); status != 400 {
		t.Fatalf("unsupported model: %d", status)
	}
	var queueName string
	if err := f.pool.QueryRow(ctx, `SELECT r.queue FROM jobs j JOIN river_job r ON r.id=j.river_job_id WHERE j.id=$1`, first.ID).Scan(&queueName); err != nil || queueName != "image" {
		t.Fatalf("queue=%s %v", queueName, err)
	}
	// Independent owners may use the same key, including standalone jobs.
	other, err := f.service.Submit(ctx, bob, "first-image", engine.Submission{Operation: imageop.GenerateName, Input: json.RawMessage(body)})
	if err != nil || other.ID == first.ID {
		t.Fatalf("cross-user idempotency: %v", err)
	}
	f.start(t)
	done := await(t, f, first.ID, "succeeded")
	bobFixture := *f
	bobFixture.owner = bob
	bobDone := await(t, &bobFixture, other.ID, "succeeded")
	bobAssetID := *bobDone.Results[0].AssetID
	if len(done.Results) != 1 || done.Results[0].AssetID == nil {
		t.Fatalf("no image asset: %+v", done)
	}
	sourceID := *done.Results[0].AssetID
	source, err := reader.service.Get(ctx, f.owner, sourceID)
	if err != nil || len(source.Files) != 1 || source.SourceAssetID != nil || source.ProjectID != nil {
		t.Fatalf("source asset: %+v %v", source, err)
	}
	sourceFile, err := store.Open(ctx, source.Files[0].StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	config, err := png.DecodeConfig(sourceFile)
	sourceFile.Close()
	if err != nil || config.Width*9 != config.Height*16 {
		t.Fatalf("image bytes: %+v %v", config, err)
	}
	editBody := `{"prompt":"make the lighting warmer","sourceAssetId":"` + sourceID + `","references":[{"assetId":"` + sourceID + `","role":"identity"}]}`
	edit, status := post("edits", "edit-image", editBody)
	if status != 202 {
		t.Fatalf("edit: %d", status)
	}
	edited := await(t, f, edit.ID, "succeeded")
	editID := *edited.Results[0].AssetID
	detail, err := reader.service.Get(ctx, f.owner, editID)
	if err != nil || detail.SourceAssetID == nil || *detail.SourceAssetID != sourceID || editID == sourceID {
		t.Fatalf("edit provenance: %+v %v", detail, err)
	}
	if source.Files[0].StorageKey == detail.Files[0].StorageKey {
		t.Fatal("edit overwrote source")
	}
	page, err := reader.service.List(ctx, f.owner, assets.ListParams{Kind: "image"})
	if err != nil || len(page.Items) != 2 {
		t.Fatalf("asset list: %+v %v", page, err)
	}
	// Reload using fresh services; neither the job nor its media relies on provider memory.
	fresh := assets.NewService(f.pool)
	if _, err := fresh.Get(ctx, f.owner, editID); err != nil {
		t.Fatal(err)
	}
	url, _ := signer.URL(f.owner, detail.Files[0].ID)
	response := httptest.NewRecorder()
	api.ServeHTTP(response, httptest.NewRequest("GET", url, nil))
	if response.Code != 200 || response.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("signed image: %d %s", response.Code, response.Body)
	}
	if _, err := png.DecodeConfig(response.Body); err != nil {
		t.Fatal(err)
	}
	// Foreign and missing references are rejected before any work is scheduled.
	for _, input := range []string{editBody, `{"prompt":"edit","sourceAssetId":"` + uuid.NewString() + `"}`} {
		_, err := f.service.Submit(ctx, bob, uuid.NewString(), engine.Submission{Operation: imageop.EditName, Input: json.RawMessage(input)})
		if !errors.Is(err, apperr.ErrNotFound) {
			t.Fatalf("foreign/missing input: %v", err)
		}
	}
	_, err = f.service.Submit(ctx, bob, "foreign-reference", engine.Submission{Operation: imageop.GenerateName, Input: json.RawMessage(`{"prompt":"cafe","references":[{"assetId":"` + sourceID + `","role":"visual_style"}]}`)})
	if !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("foreign reference: %v", err)
	}
	foreignProject, err := f.projects.Create(ctx, bob, "Bob's film")
	if err != nil {
		t.Fatal(err)
	}
	if _, status := post("generations", "foreign-project", `{"prompt":"cafe","projectId":"`+foreignProject.ID+`"}`); status != 404 {
		t.Fatalf("foreign project: %d", status)
	}
	// Provenance is owner constrained even for direct SQL writes.
	if _, err := f.pool.Exec(ctx, `UPDATE assets SET source_asset_id=$1 WHERE id=$2 AND owner_user_id=$3`, bobAssetID, sourceID, f.owner); err == nil {
		t.Fatal("database allowed cross-owner source")
	}
}
