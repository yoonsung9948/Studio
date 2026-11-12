package production

import (
	"encoding/json"
	"strings"
	"testing"
)

func testRecord(fields map[string]any) Record {
	raw, _ := json.Marshal(fields)
	var record Record
	_ = json.Unmarshal(raw, &record)
	return record
}
func TestCutCannotReferenceAnotherEpisode(t *testing.T) {
	d := Document{Project: testRecord(map[string]any{"id": "project-a", "title": "Film", "episodeIds": []string{"episode-a", "episode-b"}}), Episodes: []Record{testRecord(map[string]any{"id": "episode-a", "projectId": "project-a", "sceneIds": []string{"scene-a"}, "cut": map[string]any{"revision": 1, "clips": []any{map[string]any{"id": "clip-a", "shotId": "shot-b", "takeId": "take-b", "inFrame": 0, "outFrame": 30, "volume": 1}}, "audio": []any{}}}), testRecord(map[string]any{"id": "episode-b", "projectId": "project-a", "sceneIds": []string{"scene-b"}})}, Scenes: []Record{testRecord(map[string]any{"id": "scene-a", "episodeId": "episode-a", "shotIds": []string{}}), testRecord(map[string]any{"id": "scene-b", "episodeId": "episode-b", "shotIds": []string{"shot-b"}})}, Shots: []Record{testRecord(map[string]any{"id": "shot-b", "sceneId": "scene-b", "targetFrames": 60, "revision": 1})}, Takes: []Record{testRecord(map[string]any{"id": "take-b", "shotId": "shot-b", "assetId": "media-a", "sourceFrames": 60, "revision": 1})}, Assets: []Record{testRecord(map[string]any{"id": "media-a", "serverAssetId": "70000000-0000-4000-8000-000000000001"})}}
	if err := d.Validate("project-a"); err == nil {
		t.Fatal("accepted a clip from another episode")
	}
}
func TestHistoryCannotBeRewrittenAndCanBeRetainedOnMerge(t *testing.T) {
	entry := map[string]any{"revision": 1, "title": "Old scene", "approvedAt": 1}
	old := testRecord(map[string]any{"planRevision": 1, "planHistory": []any{entry}})
	next := testRecord(map[string]any{"planRevision": 2, "title": "Merged scene", "planHistory": []any{entry, map[string]any{"revision": 1, "title": "Source scene", "approvedAt": 2}}})
	raw, _ := json.Marshal(map[string]any{"revision": 1, "title": "Source scene", "approvedAt": 2})
	if err := validateNewApprovals(old, next, "planHistory", map[string]bool{"planHistory:" + jsonKey(raw): true}); err != nil {
		t.Fatal(err)
	}
	next["planHistory"] = json.RawMessage(`[]`)
	if err := validateNewApprovals(old, next, "planHistory", nil); err == nil {
		t.Fatal("approval history removed")
	}
}
func TestUnicodeTitlesAndSafeIDs(t *testing.T) {
	d := Document{Project: testRecord(map[string]any{"id": "project-a", "title": strings.Repeat("영화", 75), "episodeIds": []string{}})}
	if err := d.Validate("project-a"); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"__proto__", "constructor", "prototype", "../file", "bad/id", ""} {
		if validID(id) {
			t.Errorf("accepted %q", id)
		}
	}
}
