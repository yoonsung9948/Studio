//go:build integration

package engine_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/assets"
	"nori/studio/server/internal/characters"
	imageinput "nori/studio/server/internal/domain/image"
	"nori/studio/server/internal/engine"
	imageop "nori/studio/server/internal/engine/ops/image"
	"nori/studio/server/internal/httpapi"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/providers"
	"nori/studio/server/internal/providers/fake"
)

type characterImageModel struct {
	fake.Image
	calls atomic.Int32
}

func (m *characterImageModel) Generate(ctx context.Context, in providers.ImageRequest) (providers.ImageOutput, error) {
	m.calls.Add(1)
	return m.Image.Generate(ctx, in)
}
func characterFixture(t *testing.T) (*fixture, *characters.Service, *blob.Local, *characterImageModel) {
	t.Helper()
	store, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	reader := &imageAssetReader{}
	model := &characterImageModel{}
	op := imageop.NewGenerate(model, store, reader)
	f := setup(t, fake.Interpreter{}, op)
	reader.service = assets.NewService(f.pool)
	return f, characters.NewService(f.pool, f.service, op, store), store, model
}
func newCharacter(t *testing.T, s *characters.Service, owner string) characters.Detail {
	t.Helper()
	c, err := s.Create(context.Background(), owner, characters.CreateInput{Name: "Nori", Appearance: "Short black hair and brown eyes", Notes: "PRIVATE NOTES NEVER SEND"})
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func generateCharacter(t *testing.T, s *characters.Service, owner, id, key string, in characters.GenerateInput) characters.Generation {
	t.Helper()
	g, err := s.Generate(context.Background(), owner, id, key, in)
	if err != nil {
		t.Fatal(err)
	}
	return g
}
func awaitCharacter(t *testing.T, f *fixture, g characters.Generation) {
	t.Helper()
	for _, job := range g.Jobs {
		await(t, f, job.ID, "succeeded")
	}
}
func characterVersions(t *testing.T, s *characters.Service, owner, id, view string) []characters.Version {
	t.Helper()
	page, err := s.Versions(context.Background(), owner, id, characters.ListParams{View: view})
	if err != nil {
		t.Fatal(err)
	}
	return page.Items
}
func TestCharacterPipelineAndIdentityLineage(t *testing.T) {
	ctx := context.Background()
	f, s, _, _ := characterFixture(t)
	c := newCharacter(t, s, f.owner)
	if len(c.Views) != 6 || c.CanonicalVersionID != nil {
		t.Fatalf("initial views: %+v", c)
	}
	if _, err := s.Generate(ctx, f.owner, c.ID, "profile-too-early", characters.GenerateInput{Views: []string{"profile"}}); err == nil {
		t.Fatal("generated view without identity")
	}
	g := generateCharacter(t, s, f.owner, c.ID, "front", characters.GenerateInput{Count: 2})
	if len(g.Jobs) != 2 {
		t.Fatalf("jobs=%d", len(g.Jobs))
	}
	for _, job := range g.Jobs {
		if strings.Contains(string(job.Input), "PRIVATE NOTES") || job.ProjectID != nil {
			t.Fatal("private notes or a project leaked into generation")
		}
	}
	replay, err := s.Generate(ctx, f.owner, c.ID, "front", characters.GenerateInput{Count: 2})
	if err != nil || replay.ID != g.ID || replay.Jobs[0].ID != g.Jobs[0].ID {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	if _, err := s.Generate(ctx, f.owner, c.ID, "front", characters.GenerateInput{Count: 1}); !errors.Is(err, engine.ErrIdempotencyConflict) {
		t.Fatalf("conflict: %v", err)
	}
	f.start(t)
	awaitCharacter(t, f, g)
	candidates := characterVersions(t, s, f.owner, c.ID, "front")
	if len(candidates) != 2 || candidates[0].Approval != "needs_review" {
		t.Fatalf("candidates: %+v", candidates)
	}
	detail, err := s.Get(ctx, f.owner, c.ID)
	if err != nil || detail.CanonicalVersionID != nil {
		t.Fatal("generation selected identity automatically")
	}
	first, second := candidates[0], candidates[1]
	if _, err := s.Select(ctx, f.owner, c.ID, "front", first.ID); err != nil {
		t.Fatal(err)
	}
	profiles := generateCharacter(t, s, f.owner, c.ID, "angles", characters.GenerateInput{Views: []string{"profile", "back"}})
	awaitCharacter(t, f, profiles)
	profile := characterVersions(t, s, f.owner, c.ID, "profile")[0]
	if profile.SourceIdentityVersionID == nil || *profile.SourceIdentityVersionID != first.ID {
		t.Fatalf("lineage: %+v", profile)
	}
	if _, err := s.Select(ctx, f.owner, c.ID, "profile", profile.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Select(ctx, f.owner, c.ID, "front", second.ID); err != nil {
		t.Fatal(err)
	}
	profile = characterVersions(t, s, f.owner, c.ID, "profile")[0]
	if !profile.Stale {
		t.Fatal("old angle wasn't marked stale")
	}
	if _, err := s.Select(ctx, f.owner, c.ID, "profile", profile.ID); err == nil {
		t.Fatal("selected angle from previous identity")
	}
	note := "new private note"
	name := "Renamed"
	updated, err := s.Update(ctx, f.owner, c.ID, characters.UpdateInput{Name: &name, Notes: &note})
	if err != nil || updated.AppearanceRevision != 1 {
		t.Fatalf("metadata invalidated identity: %+v %v", updated, err)
	}
	appearance := "Long blonde hair"
	if _, err := s.Update(ctx, f.owner, c.ID, characters.UpdateInput{Appearance: &appearance}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Select(ctx, f.owner, c.ID, "front", second.ID); err == nil {
		t.Fatal("selected an outdated appearance")
	}
	if err := s.Reject(ctx, f.owner, c.ID, first.ID); err != nil {
		t.Fatal(err)
	}
}
func TestCharacterOwnershipAndPagination(t *testing.T) {
	ctx := context.Background()
	f, s, _, _ := characterFixture(t)
	bob := secondOwner(t, f)
	c := newCharacter(t, s, f.owner)
	other := newCharacter(t, s, bob)
	if _, err := s.Get(ctx, bob, c.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal(err)
	}
	name := "hijacked"
	if _, err := s.Update(ctx, bob, c.ID, characters.UpdateInput{Name: &name}); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, bob, c.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.Generate(ctx, bob, c.ID, "foreign", characters.GenerateInput{}); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.Versions(ctx, bob, c.ID, characters.ListParams{}); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal(err)
	}
	g := generateCharacter(t, s, f.owner, c.ID, "shared-key", characters.GenerateInput{})
	theirs := generateCharacter(t, s, bob, other.ID, "shared-key", characters.GenerateInput{})
	if g.ID == theirs.ID {
		t.Fatal("cross-owner batch reuse")
	}
	_ = newCharacter(t, s, f.owner)
	page, err := s.List(ctx, f.owner, characters.ListParams{Limit: 1})
	if err != nil || len(page.Items) != 1 || page.NextCursor == nil {
		t.Fatalf("%+v %v", page, err)
	}
	next, err := s.List(ctx, f.owner, characters.ListParams{Limit: 1, Cursor: *page.NextCursor})
	if err != nil || len(next.Items) != 1 || next.Items[0].ID == page.Items[0].ID || next.NextCursor != nil {
		t.Fatalf("%+v %v", next, err)
	}
	if _, err := s.List(ctx, f.owner, characters.ListParams{Cursor: "broken"}); err == nil {
		t.Fatal("accepted bad cursor")
	}
	if _, err := s.Generation(ctx, bob, c.ID, g.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal(err)
	}
	f.start(t)
	awaitCharacter(t, f, g)
	bobFixture := *f
	bobFixture.owner = bob
	awaitCharacter(t, &bobFixture, theirs)
	ownVersion := characterVersions(t, s, f.owner, c.ID, "front")[0]
	foreignVersion := characterVersions(t, s, bob, other.ID, "front")[0]
	if _, err := s.Select(ctx, bob, other.ID, "front", ownVersion.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("foreign version selected: %v", err)
	}
	if err := s.Reject(ctx, bob, other.ID, ownVersion.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("foreign version rejected: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE character_views SET selected_version_id=$1 WHERE character_id=$2 AND owner_user_id=$3 AND view='front'`, foreignVersion.ID, c.ID, f.owner); err == nil {
		t.Fatal("database allowed cross-owner selection")
	}
	if _, err := f.pool.Exec(ctx, `UPDATE character_image_versions SET asset_id=$1 WHERE id=$2 AND owner_user_id=$3`, foreignVersion.AssetID, ownVersion.ID, f.owner); err == nil {
		t.Fatal("database allowed cross-owner image")
	}
	_, err = s.Generate(ctx, f.owner, c.ID, "foreign-reference", characters.GenerateInput{References: []imageinput.Reference{{AssetID: foreignVersion.AssetID, Role: "identity"}}})
	if !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("foreign generation reference: %v", err)
	}
	var batches int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM character_generation_batches WHERE character_id=$1 AND owner_user_id=$2 AND idempotency_key='foreign-reference'`, c.ID, f.owner).Scan(&batches); err != nil || batches != 0 {
		t.Fatal("failed submission left a partial batch")
	}
	// Concurrent replays produce exactly one batch and its original jobs.
	var wg sync.WaitGroup
	results := make(chan characters.Generation, 2)
	failures := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := s.Generate(ctx, f.owner, c.ID, "concurrent", characters.GenerateInput{Count: 2})
			results <- result
			failures <- err
		}()
	}
	wg.Wait()
	a, b := <-results, <-results
	if a.ID != b.ID || <-failures != nil || <-failures != nil {
		t.Fatal("concurrent submission duplicated work")
	}
}
func TestCharacterCompletionAfterDeletion(t *testing.T) {
	ctx := context.Background()
	f, s, store, _ := characterFixture(t)
	c := newCharacter(t, s, f.owner)
	g := generateCharacter(t, s, f.owner, c.ID, "delete-before-completion", characters.GenerateInput{})
	if err := s.Delete(ctx, f.owner, c.ID); err != nil {
		t.Fatal(err)
	}
	f.start(t)
	awaitCharacter(t, f, g)
	if _, err := s.Get(ctx, f.owner, c.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal("deleted character reactivated")
	}
	if _, err := s.Generate(ctx, f.owner, c.ID, "another", characters.GenerateInput{}); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal(err)
	}
	page, err := s.List(ctx, f.owner, characters.ListParams{})
	if err != nil || len(page.Items) != 0 {
		t.Fatal("deleted character listed")
	}
	var assetID string
	if err := f.pool.QueryRow(ctx, `SELECT asset_id::text FROM character_image_versions WHERE character_id=$1 AND owner_user_id=$2`, c.ID, f.owner).Scan(&assetID); err != nil {
		t.Fatal(err)
	}
	asset, err := assets.NewService(f.pool).Get(ctx, f.owner, assetID)
	if err != nil || len(asset.Files) != 1 {
		t.Fatalf("lost output: %+v %v", asset, err)
	}
	object, err := store.Open(ctx, asset.Files[0].StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	object.Close()
	var selected int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM character_views WHERE character_id=$1 AND owner_user_id=$2 AND selected_version_id IS NOT NULL`, c.ID, f.owner).Scan(&selected); err != nil || selected != 0 {
		t.Fatal("completion selected a deleted character")
	}
}
func TestCharacterPublicationFailureCannotCompleteJob(t *testing.T) {
	ctx := context.Background()
	f, s, store, model := characterFixture(t)
	c := newCharacter(t, s, f.owner)
	// Force a database failure after the asset rows were inserted by the worker.
	_, err := f.pool.Exec(ctx, `CREATE FUNCTION fail_character_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test publication failure'; END $$;
 CREATE TRIGGER fail_character_publication BEFORE INSERT ON character_image_versions FOR EACH ROW EXECUTE FUNCTION fail_character_publication()`)
	if err != nil {
		t.Fatal(err)
	}
	g := generateCharacter(t, s, f.owner, c.ID, "publication", characters.GenerateInput{})
	f.start(t)
	deadline := time.Now().Add(5 * time.Second)
	failedPublication := false
	for time.Now().Before(deadline) {
		var state string
		if err := f.pool.QueryRow(ctx, `SELECT r.state::text FROM jobs j JOIN river_job r ON r.id=j.river_job_id WHERE j.id=$1 AND j.owner_user_id=$2`, g.Jobs[0].ID, f.owner).Scan(&state); err != nil {
			t.Fatal(err)
		}
		if state == "retryable" {
			failedPublication = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !failedPublication {
		t.Fatal("did not observe failed publication")
	}
	detail, err := f.service.Get(ctx, f.owner, g.Jobs[0].ID)
	if err != nil || detail.Status == "succeeded" {
		t.Fatal("job completed without character version")
	}
	for _, table := range []string{"assets", "artifacts", "character_image_versions"} {
		var count int
		column := "producer_job_id"
		if err := f.pool.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE "+column+"=$1", g.Jobs[0].ID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("partial publication in %s: %d %v", table, count, err)
		}
	}
	file, err := store.Open(ctx, "jobs/"+g.Jobs[0].ID+"/image.png")
	if err != nil {
		t.Fatal("file was not stored before publication")
	}
	file.Close()
	if _, err := f.pool.Exec(ctx, `DROP TRIGGER fail_character_publication ON character_image_versions`); err != nil {
		t.Fatal(err)
	}
	var riverID int64
	if err := f.pool.QueryRow(ctx, `SELECT river_job_id FROM jobs WHERE id=$1 AND owner_user_id=$2`, g.Jobs[0].ID, f.owner).Scan(&riverID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.queue.JobRetry(ctx, riverID); err != nil {
		t.Fatal(err)
	}
	awaitCharacter(t, f, g)
	if model.calls.Load() != 1 {
		t.Fatalf("publication retry regenerated image: %d", model.calls.Load())
	}
	if versions := characterVersions(t, s, f.owner, c.ID, "front"); len(versions) != 1 {
		t.Fatalf("duplicate versions: %+v", versions)
	}
}
func TestCharacterHTTPAndUploads(t *testing.T) {
	ctx := context.Background()
	f, s, _, _ := characterFixture(t)
	api := httpapi.New(httpapi.Services{Characters: s, Accounts: accounts.NewService(f.pool), Authenticate: fixtureAuthentication}, slog.New(slog.NewTextHandler(io.Discard, nil)), f.pool.Ping)
	call := func(method, path, body, key string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Idempotency-Key", key)
		response := httptest.NewRecorder()
		api.ServeHTTP(response, req)
		return response
	}
	for _, body := range []string{`null`, `{"name":"Nori","ownerUserId":"other"}`, `{"name":"Nori","projectId":"` + uuid.NewString() + `"}`} {
		if r := call("POST", "/api/v1/characters", body, ""); r.Code != 400 {
			t.Fatalf("accepted untrusted input: %d %s", r.Code, r.Body)
		}
	}
	r := call("POST", "/api/v1/characters", `{"name":"Nori","appearance":"Short hair"}`, "")
	if r.Code != 201 {
		t.Fatalf("create: %d %s", r.Code, r.Body)
	}
	var c characters.Detail
	if err := json.Unmarshal(r.Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/characters/" + c.ID
	if r := call("GET", base, "", ""); r.Code != 200 {
		t.Fatalf("get: %d %s", r.Code, r.Body)
	}
	if r := call("PATCH", base, `{"notes":"private"}`, ""); r.Code != 200 {
		t.Fatalf("patch: %d %s", r.Code, r.Body)
	}
	if r := call("GET", "/api/v1/characters?limit=0", "", ""); r.Code != 400 {
		t.Fatal("accepted zero limit")
	}
	sample, err := (fake.Image{}).Download(ctx, "image-1-1.png")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(sample)
	sample.Close()
	if err != nil {
		t.Fatal(err)
	}
	r = call("POST", base+"/uploads", string(raw), "upload")
	if r.Code != 201 {
		t.Fatalf("upload: %d %s", r.Code, r.Body)
	}
	var version characters.Version
	if err := json.Unmarshal(r.Body.Bytes(), &version); err != nil {
		t.Fatal(err)
	}
	again, err := s.Upload(ctx, f.owner, c.ID, "upload", bytes.NewReader(raw))
	if err != nil || again.ID != version.ID {
		t.Fatal("duplicate upload")
	}
	alternate, err := (fake.Image{}).Download(ctx, "image-9-16.png")
	if err != nil {
		t.Fatal(err)
	}
	defer alternate.Close()
	if _, err := s.Upload(ctx, f.owner, c.ID, "upload", alternate); !errors.Is(err, engine.ErrIdempotencyConflict) {
		t.Fatal("upload conflict not detected")
	}
	if r := call("PUT", base+"/views/front/selection", `{"versionId":"`+version.ID+`"}`, ""); r.Code != 200 {
		t.Fatalf("select: %d %s", r.Code, r.Body)
	}
	if r := call("GET", base+"/versions?view=front", "", ""); r.Code != 200 {
		t.Fatalf("versions: %d %s", r.Code, r.Body)
	}
	if r := call("POST", base+"/generations", `{"views":["profile"],"count":1}`, "profile"); r.Code != 202 {
		t.Fatalf("generation: %d %s", r.Code, r.Body)
	}
	if r := call("POST", base+"/versions/"+version.ID+"/reject", "", ""); r.Code != 204 {
		t.Fatalf("reject: %d %s", r.Code, r.Body)
	}
	if r := call("DELETE", base, "", ""); r.Code != 204 {
		t.Fatalf("delete: %d %s", r.Code, r.Body)
	}
	if r := call("GET", base, "", ""); r.Code != 404 {
		t.Fatal("deleted character accessible")
	}
}

func TestCharacterGenerationKeepsInputSnapshot(t *testing.T) {
	ctx := context.Background()
	f, s, _, _ := characterFixture(t)
	c := newCharacter(t, s, f.owner)
	g := generateCharacter(t, s, f.owner, c.ID, "snapshot", characters.GenerateInput{})
	appearance := "Long silver hair"
	if _, err := s.Update(ctx, f.owner, c.ID, characters.UpdateInput{Appearance: &appearance}); err != nil {
		t.Fatal(err)
	}
	replay, err := s.Generate(ctx, f.owner, c.ID, "snapshot", characters.GenerateInput{})
	if err != nil || replay.ID != g.ID {
		t.Fatalf("replay changed with appearance: %+v %v", replay, err)
	}
	f.start(t)
	awaitCharacter(t, f, g)
	version := characterVersions(t, s, f.owner, c.ID, "front")[0]
	if !version.Stale || version.AppearanceRevision != 1 || !strings.Contains(version.Prompt, "Short black hair") || strings.Contains(version.Prompt, appearance) {
		t.Fatalf("mutable generation input: %+v", version)
	}
	if _, err := s.Select(ctx, f.owner, c.ID, "front", version.ID); err == nil {
		t.Fatal("selected in-flight outdated result")
	}
}
