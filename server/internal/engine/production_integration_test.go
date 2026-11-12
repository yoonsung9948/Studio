//go:build integration

package engine_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"testing"

	"nori/studio/server/internal/assets"
	"nori/studio/server/internal/billing"
	"nori/studio/server/internal/characters"
	"nori/studio/server/internal/engine"
	imageop "nori/studio/server/internal/engine/ops/image"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/production"
	"nori/studio/server/internal/providers/fake"
	refs "nori/studio/server/internal/references"
)

func record(value map[string]any) production.Record {
	raw, _ := json.Marshal(value)
	var r production.Record
	_ = json.Unmarshal(raw, &r)
	return r
}
func field(r production.Record, key string, value any) { r[key], _ = json.Marshal(value) }
func productionFixture(t *testing.T) (*fixture, blob.Store, *production.Service) {
	t.Helper()
	files, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	reader := &imageAssetReader{}
	f := setup(t, fake.Interpreter{}, imageop.NewGenerate(fake.Image{}, files, reader), imageop.NewEdit(fake.Image{}, files, reader))
	reader.service = assets.NewService(f.pool)
	return f, files, production.NewService(f.pool, f.service)
}
func draft(t *testing.T, f *fixture, s *production.Service) (string, production.Document) {
	t.Helper()
	ctx := context.Background()
	project, err := f.projects.Create(ctx, f.owner, "A film")
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.Get(ctx, f.owner, project.ID)
	if err != nil {
		t.Fatal(err)
	}
	field(d.Project, "episodeIds", []string{"episode-a"})
	d.Episodes = []production.Record{record(map[string]any{"id": "episode-a", "projectId": project.ID, "title": "Episode", "sceneIds": []string{"scene-a"}, "revision": 1, "scriptRevision": 1, "script": "A quiet cafe."})}
	d.Scenes = []production.Record{record(map[string]any{"id": "scene-a", "episodeId": "episode-a", "title": "Cafe", "shotIds": []string{"shot-a"}, "planRevision": 1, "revision": 1})}
	d.Shots = []production.Record{record(map[string]any{"id": "shot-a", "sceneId": "scene-a", "title": "Opening", "targetFrames": 120, "revision": 1})}
	return project.ID, d
}
func TestProductionPersistenceAndOwnership(t *testing.T) {
	ctx := context.Background()
	f, _, s := productionFixture(t)
	id, d := draft(t, f, s)
	saved, err := s.Save(ctx, f.owner, id, d)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Revision != 1 {
		t.Fatal("missing revision")
	}
	replay, err := s.Save(ctx, f.owner, id, d)
	if err != nil || replay.Revision != 1 {
		t.Fatalf("uncertain save replay: %v", err)
	}
	fresh := production.NewService(f.pool)
	loaded, err := fresh.Get(ctx, f.owner, id)
	if err != nil || len(loaded.Shots) != 1 || loaded.Scenes[0].Text("title") != "Cafe" {
		t.Fatalf("reload: %+v %v", loaded, err)
	}
	stale := loaded
	field(loaded.Project, "title", "Updated")
	saved, err = s.Save(ctx, f.owner, id, loaded)
	if err != nil {
		t.Fatal(err)
	}
	field(stale.Project, "title", "Another tab")
	// Get fresh independent copies: map values in a copied Go struct share storage.
	stale, err = fresh.Get(ctx, f.owner, id)
	if err != nil {
		t.Fatal(err)
	}
	stale.Revision = 1
	field(stale.Project, "title", "Another tab")
	var conflict *apperr.ConflictError
	if _, err := s.Save(ctx, f.owner, id, stale); !errors.As(err, &conflict) {
		t.Fatalf("lost update accepted: %v", err)
	}
	bob := secondOwner(t, f)
	if _, err := s.Get(ctx, bob, id); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal("foreign read")
	}
	if _, err := s.Save(ctx, bob, id, saved); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatalf("foreign write: %v", err)
	}
	if err := s.Delete(ctx, bob, id); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal("foreign delete")
	}
	if err := s.Delete(ctx, f.owner, id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, f.owner, id); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal("archived production accessible")
	}
	var count int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM production_revisions WHERE project_id=$1 AND owner_user_id=$2`, id, f.owner).Scan(&count); err != nil || count != 2 {
		t.Fatalf("history lost: %d %v", count, err)
	}
}
func TestCharacterEditsAndProductionSnapshots(t *testing.T) {
	ctx := context.Background()
	f, files, s := productionFixture(t)
	f.start(t)
	c := characters.NewService(f.pool, f.service, imageop.NewGenerate(fake.Image{}, files, assets.NewService(f.pool)), files)
	character, err := c.Create(ctx, f.owner, characters.CreateInput{Name: "Maya", Appearance: "Short dark hair"})
	if err != nil {
		t.Fatal(err)
	}
	batch, err := c.Generate(ctx, f.owner, character.ID, "front", characters.GenerateInput{Views: []string{"front"}, Count: 1})
	if err != nil {
		t.Fatal(err)
	}
	await(t, f, batch.Jobs[0].ID, "succeeded")
	versions, err := c.Versions(ctx, f.owner, character.ID, characters.ListParams{})
	if err != nil || len(versions.Items) != 1 {
		t.Fatal(err)
	}
	front := versions.Items[0]
	if _, err := c.Select(ctx, f.owner, character.ID, "front", front.ID); err != nil {
		t.Fatal(err)
	}
	edited, err := c.Generate(ctx, f.owner, character.ID, "edit", characters.GenerateInput{Views: []string{"front"}, Count: 1, Prompt: "Warm light", SourceVersionID: front.ID})
	if err != nil {
		t.Fatal(err)
	}
	await(t, f, edited.Jobs[0].ID, "succeeded")
	versions, err = c.Versions(ctx, f.owner, character.ID, characters.ListParams{})
	if err != nil || len(versions.Items) != 2 {
		t.Fatal("edit was not published as a new candidate")
	}
	id, d := draft(t, f, s)
	d.Characters = []production.Record{record(map[string]any{"id": "cast-a", "projectId": id, "sourceCharacterId": character.ID, "name": "Maya", "appearance": "Short dark hair", "revision": 1, "canonicalVersionId": "identity-a"})}
	d.Assets = []production.Record{record(map[string]any{"id": "image-a", "serverAssetId": front.AssetID, "projectId": id, "kind": "image", "title": "Maya"})}
	d.Versions = []production.Record{record(map[string]any{"id": "identity-a", "projectId": id, "ownerKind": "identity", "ownerId": "cast-a", "assetId": "image-a", "revision": 1, "approval": "approved"})}
	d.Looks = []production.Record{record(map[string]any{"id": "look-a", "characterId": "cast-a", "episodeId": "episode-a", "name": "Raincoat", "description": "Yellow raincoat", "revision": 1})}
	if _, err := s.Save(ctx, f.owner, id, d); err != nil {
		t.Fatal(err)
	}
	if err := c.Delete(ctx, f.owner, character.ID); err != nil {
		t.Fatal(err)
	}
	restored, err := s.Get(ctx, f.owner, id)
	if err != nil || restored.Characters[0].Text("name") != "Maya" || len(restored.Versions) != 1 {
		t.Fatal("library deletion changed production snapshot")
	}
	references := refs.NewService(f.pool, f.service)
	generated, err := references.Generate(ctx, f.owner, "look", "look-a", "look-front", refs.GenerateInput{Views: []string{"front"}, Count: 1, Prompt: "Neutral light"})
	if err != nil {
		t.Fatal(err)
	}
	await(t, f, generated.Jobs[0].ID, "succeeded")
	candidates, _, err := references.Versions(ctx, f.owner, "look", "look-a", "")
	if err != nil || len(candidates) != 1 {
		t.Fatalf("look candidates: %+v %v", candidates, err)
	}
	if err := references.Select(ctx, f.owner, "look", "look-a", "front", candidates[0].ID); err != nil {
		t.Fatal(err)
	}
	restored, err = s.Get(ctx, f.owner, id)
	if err != nil || restored.Looks[0].Text("primaryVersionId") != candidates[0].ID {
		t.Fatalf("look selection not persisted: %v", err)
	}
}
func TestReferenceLibraryAndTakeDelivery(t *testing.T) {
	ctx := context.Background()
	f, files, s := productionFixture(t)
	f.start(t)
	references := refs.NewService(f.pool, f.service)
	for _, kind := range []string{"place", "prop"} {
		subject, err := references.Create(ctx, f.owner, kind, refs.Input{Name: "Studio", Description: "Warm wood"})
		if err != nil {
			t.Fatal(err)
		}
		generated, err := references.Generate(ctx, f.owner, kind, subject.ID, "generate", refs.GenerateInput{Views: []string{"front"}, Count: 1})
		if err != nil {
			t.Fatal(err)
		}
		again, err := references.Generate(ctx, f.owner, kind, subject.ID, "generate", refs.GenerateInput{Views: []string{"front"}, Count: 1})
		if err != nil || again.Jobs[0].ID != generated.Jobs[0].ID {
			t.Fatalf("generation replay: %v", err)
		}
		await(t, f, generated.Jobs[0].ID, "succeeded")
		versions, _, err := references.Versions(ctx, f.owner, kind, subject.ID, "")
		if err != nil || len(versions) != 1 {
			t.Fatal("reference candidate missing")
		}
		if err := references.Select(ctx, f.owner, kind, subject.ID, "front", versions[0].ID); err != nil {
			t.Fatal(err)
		}
		reloaded, err := references.Get(ctx, f.owner, kind, subject.ID)
		if err != nil || reloaded.Views["front"] != versions[0].ID {
			t.Fatal("reference selection missing")
		}
		if err := references.Delete(ctx, f.owner, kind, subject.ID); err != nil {
			t.Fatal(err)
		}
	}
	id, d := draft(t, f, s)
	if _, err := s.Save(ctx, f.owner, id, d); err != nil {
		t.Fatal(err)
	}
	request := production.GenerateInput{Kind: "image", Prompt: "Quiet cafe", AspectRatio: "16:9", Snapshot: record(map[string]any{"targetFrames": 120, "model": "demo", "instructions": "Quiet cafe", "referenceInputs": []any{}, "aspectRatio": "16:9", "locationMode": "none", "direction": map[string]string{"time": "", "lighting": "", "mood": "", "style": "", "camera": "", "notes": ""}})}
	job, err := s.Generate(ctx, f.owner, id, "shot-a", "shot-image", request)
	if err != nil {
		t.Fatal(err)
	}
	done := await(t, f, job.ID, "succeeded")
	if len(done.Results) != 1 {
		t.Fatal("missing asset")
	}
	restored, err := s.Get(ctx, f.owner, id)
	if err != nil || len(restored.Takes) != 1 || len(restored.Assets) != 1 {
		t.Fatalf("take delivery: %+v %v", restored, err)
	}
	take := restored.Takes[0]
	if take.Flag("approved") {
		t.Fatal("generation auto-approved a take")
	}
	field(take, "approved", true)
	field(restored.Shots[0], "imageTakeId", take.Text("id"))
	field(restored.Episodes[0], "cut", map[string]any{"revision": 1, "clips": []any{map[string]any{"id": "clip-a", "shotId": "shot-a", "takeId": take.Text("id"), "inFrame": 0, "outFrame": 90, "volume": 1}}, "audio": []any{}, "captions": true, "aspectRatio": "16:9"})
	if _, err := s.Save(ctx, f.owner, id, restored); err != nil {
		t.Fatal(err)
	}
	restored, err = production.NewService(f.pool).Get(ctx, f.owner, id)
	if err != nil || !restored.Takes[0].Flag("approved") || len(restored.Episodes[0]["cut"]) == 0 {
		t.Fatal("cut or approval lost")
	}
	field(restored.Takes[0], "inputs", map[string]any{"targetFrames": 999})
	if _, err := s.Save(ctx, f.owner, id, restored); err == nil {
		t.Fatal("changed immutable generation inputs")
	}
	// Removing an episode hides its takes without destroying their retained history.
	restored, err = s.Get(ctx, f.owner, id)
	if err != nil {
		t.Fatal(err)
	}
	restored.Episodes = []production.Record{}
	restored.Scenes = []production.Record{}
	restored.Shots = []production.Record{}
	restored.Takes = []production.Record{}
	field(restored.Project, "episodeIds", []string{})
	if _, err := s.Save(ctx, f.owner, id, restored); err != nil {
		t.Fatal(err)
	}
	restored, err = s.Get(ctx, f.owner, id)
	if err != nil || len(restored.Takes) != 0 {
		t.Fatalf("removed takes reappeared: %v", err)
	}
	var retained int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM production_takes WHERE project_id=$1 AND owner_user_id=$2`, id, f.owner).Scan(&retained); err != nil || retained != 1 {
		t.Fatal("take history destroyed")
	}
	// Asset data survives deletion of its production because revision history retains it.
	if err := s.Delete(ctx, f.owner, id); err != nil {
		t.Fatal(err)
	}
	media := assets.NewMediaService(f.pool, files)
	if err := media.Delete(ctx, f.owner, *done.Results[0].AssetID); err == nil {
		t.Fatal("deleted retained generated asset")
	}
	var balance int64
	if err := f.pool.QueryRow(ctx, `SELECT reserved FROM credit_wallets WHERE owner_user_id=$1`, f.owner).Scan(&balance); err != nil || balance != 0 {
		t.Fatal("credits not settled")
	}
}
func TestUnusedUploadDeletionAndIsolation(t *testing.T) {
	ctx := context.Background()
	f, files, _ := productionFixture(t)
	media := assets.NewMediaService(f.pool, files)
	sample, err := (fake.Image{}).Download(ctx, "image-1-1.png")
	if err != nil {
		t.Fatal(err)
	}
	defer sample.Close()
	data, err := io.ReadAll(sample)
	if err != nil {
		t.Fatal(err)
	}
	upload := func(key string) (assets.Detail, error) {
		return media.Upload(ctx, f.owner, key, nil, bytes.NewReader(data))
	}
	asset, err := upload("upload")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := upload("upload")
	if err != nil || replay.ID != asset.ID {
		t.Fatal("upload not idempotent")
	}
	if err := media.Delete(ctx, secondOwner(t, f), asset.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal("foreign media deletion")
	}
	if err := media.Delete(ctx, f.owner, asset.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := assets.NewService(f.pool).Get(ctx, f.owner, asset.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal("deleted asset readable")
	}
	if err := media.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := files.Open(ctx, asset.Files[0].StorageKey); !errors.Is(err, blob.ErrNotFound) {
		t.Fatal("unused bytes were not cleaned")
	}
}

func TestShotBatchCreditsAreAtomic(t *testing.T) {
	ctx := context.Background()
	f, _, s := productionFixture(t)
	id, d := draft(t, f, s)
	if _, err := s.Save(ctx, f.owner, id, d); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE credit_wallets SET available=24 WHERE owner_user_id=$1`, f.owner); err != nil {
		t.Fatal(err)
	}
	input := production.GenerateInput{Kind: "image", Count: 4, Prompt: "A quiet cafe", AspectRatio: "1:1", Snapshot: record(map[string]any{"targetFrames": 120})}
	if _, err := s.GenerateBatch(ctx, f.owner, id, "shot-a", "batch", input); !errors.Is(err, billing.ErrInsufficientCredits) {
		t.Fatalf("expected insufficient credits: %v", err)
	}
	var count int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE owner_user_id=$1`, f.owner).Scan(&count); err != nil || count != 0 {
		t.Fatalf("partial jobs persisted: %d %v", count, err)
	}
	var available, reserved int64
	if err := f.pool.QueryRow(ctx, `SELECT available,reserved FROM credit_wallets WHERE owner_user_id=$1`, f.owner).Scan(&available, &reserved); err != nil || available != 24 || reserved != 0 {
		t.Fatal("partial reservation")
	}
	if _, err := f.pool.Exec(ctx, `UPDATE credit_wallets SET available=32 WHERE owner_user_id=$1`, f.owner); err != nil {
		t.Fatal(err)
	}
	jobs, err := s.GenerateBatch(ctx, f.owner, id, "shot-a", "batch", input)
	if err != nil || len(jobs) != 4 {
		t.Fatalf("batch: %v", err)
	}
	replay, err := s.GenerateBatch(ctx, f.owner, id, "shot-a", "batch", input)
	if err != nil || replay[0].ID != jobs[0].ID {
		t.Fatalf("batch replay: %v", err)
	}
	input.Count = 3
	if _, err := s.GenerateBatch(ctx, f.owner, id, "shot-a", "batch", input); !errors.Is(err, engine.ErrIdempotencyConflict) {
		t.Fatal("changed batch accepted")
	}
	f.start(t)
	for _, job := range jobs {
		await(t, f, job.ID, "succeeded")
	}
}
func TestReferenceFrontChangesInvalidateSideViews(t *testing.T) {
	ctx := context.Background()
	f, _, _ := productionFixture(t)
	f.start(t)
	service := refs.NewService(f.pool, f.service)
	subject, err := service.Create(ctx, f.owner, "prop", refs.Input{Name: "Watch", Description: "Steel watch"})
	if err != nil {
		t.Fatal(err)
	}
	generate := func(view, key string) refs.Version {
		t.Helper()
		g, err := service.Generate(ctx, f.owner, "prop", subject.ID, key, refs.GenerateInput{Views: []string{view}, Count: 1})
		if err != nil {
			t.Fatal(err)
		}
		done := await(t, f, g.Jobs[0].ID, "succeeded")
		versions, _, err := service.Versions(ctx, f.owner, "prop", subject.ID, "")
		if err != nil {
			t.Fatal(err)
		}
		for _, v := range versions {
			if v.AssetID == *done.Results[0].AssetID {
				return v
			}
		}
		t.Fatal("no candidate")
		return refs.Version{}
	}
	front := generate("front", "front")
	if err := service.Select(ctx, f.owner, "prop", subject.ID, "front", front.ID); err != nil {
		t.Fatal(err)
	}
	side := generate("side", "side")
	if err := service.Select(ctx, f.owner, "prop", subject.ID, "side", side.ID); err != nil {
		t.Fatal(err)
	}
	replacement := generate("front", "new-front")
	if err := service.Select(ctx, f.owner, "prop", subject.ID, "front", replacement.ID); err != nil {
		t.Fatal(err)
	}
	versions, _, err := service.Versions(ctx, f.owner, "prop", subject.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	stale := false
	for _, v := range versions {
		if v.ID == side.ID {
			stale = v.Stale
		}
	}
	if !stale {
		t.Fatal("dependent side view was not marked stale")
	}
	if err := service.Select(ctx, f.owner, "prop", subject.ID, "side", side.ID); err == nil {
		t.Fatal("stale candidate selected")
	}
}
