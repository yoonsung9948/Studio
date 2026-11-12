package production

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"unicode/utf8"

	"nori/studio/server/internal/platform/apperr"
)

type Record map[string]json.RawMessage

func (r Record) Text(key string) string {
	var value string
	_ = json.Unmarshal(r[key], &value)
	return value
}
func (r Record) Number(key string) int {
	var value int
	_ = json.Unmarshal(r[key], &value)
	return value
}
func (r Record) Strings(key string) []string {
	var value []string
	_ = json.Unmarshal(r[key], &value)
	return value
}
func (r Record) Flag(key string) bool {
	var value bool
	_ = json.Unmarshal(r[key], &value)
	return value
}

type Document struct {
	Revision   int      `json:"revision"`
	Project    Record   `json:"project"`
	Episodes   []Record `json:"episodes"`
	Scenes     []Record `json:"scenes"`
	Shots      []Record `json:"shots"`
	Characters []Record `json:"characters"`
	Looks      []Record `json:"looks"`
	Locations  []Record `json:"locations"`
	Props      []Record `json:"props"`
	Versions   []Record `json:"versions"`
	Takes      []Record `json:"takes"`
	Setups     []Record `json:"setups"`
	References []Record `json:"references"`
	Exports    []Record `json:"exports"`
	Assets     []Record `json:"assets"`
}

type group struct {
	name, parentField, parentGroup string
	records                        []Record
}

func (d Document) groups() []group {
	return []group{
		{"episodes", "projectId", "", d.Episodes}, {"scenes", "episodeId", "episodes", d.Scenes}, {"shots", "sceneId", "scenes", d.Shots},
		{"characters", "projectId", "", d.Characters}, {"looks", "characterId", "characters", d.Looks},
		{"locations", "projectId", "", d.Locations}, {"props", "projectId", "", d.Props},
		{"versions", "ownerId", "", d.Versions}, {"takes", "shotId", "shots", d.Takes},
		{"setups", "sceneId", "scenes", d.Setups}, {"references", "characterId", "characters", d.References}, {"exports", "episodeId", "episodes", d.Exports},
	}
}
func invalid(message string) error { return &apperr.ValidationError{Message: message} }
func (d Document) Validate(project string) error {
	if d.Revision < 0 {
		return invalid("Invalid production revision")
	}
	if d.Project == nil || d.Project.Text("id") != project || strings.TrimSpace(d.Project.Text("title")) == "" || utf8.RuneCountInString(d.Project.Text("title")) > 200 {
		return invalid("A production needs a valid project and title")
	}
	groups := map[string]map[string]Record{}

	for _, g := range d.groups() {
		records := map[string]Record{}
		if len(g.records) > 2000 {
			return invalid("Production is too large")
		}
		for _, record := range g.records {
			id := record.Text("id")
			if !validID(id) || records[id] != nil {
				return invalid("Production IDs must be unique and non-empty")
			}

			records[id] = record
			if record.Text("projectId") != "" && record.Text("projectId") != project {
				return invalid("Resource belongs to another production")
			}
			if record.Number("revision") < 0 {
				return invalid("Revision must not be negative")
			}
		}
		groups[g.name] = records
	}
	has := func(group, id string) bool { return groups[group][id] != nil }
	for _, g := range d.groups() {
		for _, record := range g.records {
			if g.parentGroup != "" && !has(g.parentGroup, record.Text(g.parentField)) {
				return invalid("Missing or foreign " + g.parentField)
			}
		}
	}
	validateOrder := func(ids []string, child, parent, field string) error {
		seen := map[string]bool{}
		for _, id := range ids {
			if seen[id] || !has(child, id) || groups[child][id].Text(field) != parent {
				return invalid("Invalid production ordering")
			}
			seen[id] = true
		}
		for id, record := range groups[child] {
			if record.Text(field) == parent && !record.Flag("archived") && !seen[id] {
				return invalid("Active resource missing from ordering")
			}
		}
		return nil
	}
	if err := validateOrder(d.Project.Strings("episodeIds"), "episodes", project, "projectId"); err != nil {
		return err
	}
	for _, episode := range d.Episodes {
		if err := validateOrder(episode.Strings("sceneIds"), "scenes", episode.Text("id"), "episodeId"); err != nil {
			return err
		}
	}
	for _, scene := range d.Scenes {
		if err := validateOrder(scene.Strings("shotIds"), "shots", scene.Text("id"), "sceneId"); err != nil {
			return err
		}
	}
	for _, look := range d.Looks {
		if id := look.Text("episodeId"); id != "" && !has("episodes", id) {
			return invalid("Looks belong to an episode")
		}
	}
	media := map[string]bool{}
	for _, asset := range d.Assets {
		id := asset.Text("id")
		if !validID(id) || media[id] || asset.Text("serverAssetId") == "" {
			return invalid("Media must reference a stored owned asset")
		}
		media[id] = true
		if asset.Text("url") != "" {
			return invalid("Media URLs are not persisted")
		}
	}
	for _, take := range d.Takes {
		if !media[take.Text("assetId")] {
			return invalid("Take media is missing")
		}
	}
	for _, version := range d.Versions {
		if !media[version.Text("assetId")] {
			return invalid("Image version media is missing")
		}
	}
	for _, shot := range d.Shots {
		if shot.Number("targetFrames") < 1 {
			return invalid("Shot duration must be positive")
		}
		for _, field := range []string{"currentTakeId", "candidateTakeId", "imageTakeId"} {
			if id := shot.Text(field); id != "" && (!has("takes", id) || groups["takes"][id].Text("shotId") != shot.Text("id")) {
				return invalid("Selected take belongs to another shot")
			}
		}
		for _, id := range shot.Strings("characters") {
			if !has("characters", id) {
				return invalid("Shot character is missing")
			}
		}
	}
	for _, episode := range d.Episodes {
		for _, id := range episode.Strings("characterIds") {
			if !has("characters", id) {
				return invalid("Episode character is missing")
			}
		}
		for _, id := range episode.Strings("mediaAssetIds") {
			if !media[id] {
				return invalid("Episode media is missing")
			}
		}
		if raw := episode["cut"]; len(raw) > 0 && string(raw) != "null" {
			if err := validateCut(raw, groups["takes"], groups["shots"], groups["scenes"], media, episode.Text("id")); err != nil {
				return err
			}
		}
	}
	// Every version ID selected by editorial state must resolve inside this production.
	for _, g := range d.groups() {
		for _, record := range g.records {
			for _, field := range []string{"canonicalVersionId", "primaryVersionId", "activeVersionId", "identityVersionId", "sourceIdentityVersionId", "sourceLookVersionId", "lookVersionId"} {
				if id := record.Text(field); id != "" && !has("versions", id) {
					return invalid("Missing pinned media version: " + field)
				}
			}
			for _, field := range []string{"locationIds", "propIds"} {
				kind := "locations"
				if field == "propIds" {
					kind = "props"
				}
				for _, id := range record.Strings(field) {
					if !has(kind, id) {
						return invalid("Missing production reference")
					}
				}
			}
		}
	}
	return d.validateReferences(groups, media)
}
func validateCut(raw json.RawMessage, takes, shots, scenes map[string]Record, media map[string]bool, episode string) error {
	var cut struct {
		Revision int `json:"revision"`
	}
	if json.Unmarshal(raw, &cut) != nil || cut.Revision < 1 {
		return invalid("Invalid cut")
	}

	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	var clips []Record
	if json.Unmarshal(fields["clips"], &clips) != nil {
		return invalid("Invalid cut clips")
	}
	seen := map[string]bool{}
	for _, clip := range clips {
		if !validVolume(clip["volume"]) {
			return invalid("Invalid clip volume")
		}
		shot, take := shots[clip.Text("shotId")], takes[clip.Text("takeId")]
		if seen[clip.Text("id")] || shot == nil || take == nil || take.Text("shotId") != shot.Text("id") || scenes[shot.Text("sceneId")].Text("episodeId") != episode {
			return invalid("Cut references another episode or an invalid take")
		}
		seen[clip.Text("id")] = true
		if clip.Number("inFrame") < 0 || clip.Number("outFrame") <= clip.Number("inFrame") || clip.Number("outFrame") > take.Number("sourceFrames") {
			return invalid("Invalid cut trim")
		}
	}
	var audio []Record
	if json.Unmarshal(fields["audio"], &audio) != nil {
		return invalid("Invalid cut audio")
	}
	for _, item := range audio {
		if !validVolume(item["volume"]) {
			return invalid("Invalid audio volume")
		}
		if !media[item.Text("assetId")] || item.Number("startFrame") < 0 || item.Number("inFrame") < 0 || item.Number("outFrame") <= item.Number("inFrame") {
			return invalid("Invalid cut audio")
		}
	}
	return nil
}

func preserveHistory(old, next Record, field string) error {
	var before, after []json.RawMessage
	if json.Unmarshal(old[field], &before) != nil {
		before = nil
	}
	if json.Unmarshal(next[field], &after) != nil {
		after = nil
	}
	if len(after) < len(before) {
		return invalid("Approval history cannot be removed")
	}
	for i := range before {
		var a, b any
		_ = json.Unmarshal(before[i], &a)
		_ = json.Unmarshal(after[i], &b)
		if !reflect.DeepEqual(a, b) {
			return invalid("Approval history cannot be changed")
		}
	}
	return nil
}

func validVolume(raw json.RawMessage) bool {
	var value float64
	return json.Unmarshal(raw, &value) == nil && !math.IsNaN(value) && value >= 0 && value <= 1
}
func (d Document) validateReferences(groups map[string]map[string]Record, media map[string]bool) error {
	var walk func(any) error
	walk = func(value any) error {
		switch object := value.(type) {
		case map[string]any:
			for key, value := range object {
				if id, ok := value.(string); ok && id != "" {
					group := ""
					switch key {
					case "characterId":
						group = "characters"
					case "lookId":
						group = "looks"
					case "locationId":
						group = "locations"
					case "assetId", "outputAssetId", "startingFrameAssetId", "endingFrameAssetId", "locationAssetId":
						if !media[id] {
							return invalid("Missing pinned media")
						}
					case "identityVersionId", "lookVersionId", "sourceIdentityVersionId", "sourceLookVersionId":
						group = "versions"
					}
					if group != "" && groups[group][id] == nil {
						return invalid("Missing pinned " + key)
					}
				}
				if err := walk(value); err != nil {
					return err
				}
			}
		case []any:
			for _, item := range object {
				if err := walk(item); err != nil {
					return err
				}
			}
		}
		return nil
	}
	for _, g := range d.groups() {
		for _, record := range g.records {
			checked := record
			if g.name == "takes" {
				checked = Record{}
				for key, value := range record {
					if key != "references" && key != "inputs" {
						checked[key] = value
					}
				}
			}
			raw, _ := json.Marshal(checked)
			var value any
			_ = json.Unmarshal(raw, &value)
			if err := walk(value); err != nil {
				return err
			}
		}
	}
	for _, character := range d.Characters {
		if id := character.Text("canonicalVersionId"); id != "" {
			v := groups["versions"][id]
			if v == nil || v.Text("ownerId") != character.Text("id") || v.Text("ownerKind") != "identity" {
				return invalid("Identity belongs to another character")
			}
		}
	}
	for _, look := range d.Looks {
		if id := look.Text("primaryVersionId"); id != "" {
			v := groups["versions"][id]
			if v == nil || v.Text("ownerId") != look.Text("id") {
				return invalid("Look image belongs to another subject")
			}
		}
	}
	for _, episode := range d.Episodes {
		approved := episode.Number("scriptApprovedRevision")
		if approved > 0 {
			var history []Record
			_ = json.Unmarshal(episode["scriptHistory"], &history)
			matched := false
			for _, entry := range history {
				if entry.Number("revision") == approved {
					matched = true
					if approved == episode.Number("scriptRevision") && entry.Text("script") != episode.Text("script") {
						return invalid("Current script differs from its approval")
					}
				}
			}
			if !matched {
				return invalid("Script approval history is required")
			}
		}
		if episode.Number("scriptApprovedRevision") > episode.Number("scriptRevision") {
			return invalid("Approval refers to a future script revision")
		}
	}
	for _, shot := range d.Shots {
		selected := shot.Text("currentTakeId")
		if selected == "" {
			selected = shot.Text("imageTakeId")
		}
		take := groups["takes"][selected]
		if take == nil {
			continue
		}
		scene := groups["scenes"][shot.Text("sceneId")]
		episode := groups["episodes"][scene.Text("episodeId")]
		var inputs Record
		_ = json.Unmarshal(take["inputs"], &inputs)
		if take.Number("revision") != shot.Number("revision") || (inputs.Number("scriptRevision") > 0 && inputs.Number("scriptRevision") != episode.Number("scriptRevision")) || (inputs.Number("planRevision") > 0 && inputs.Number("planRevision") != scene.Number("planRevision")) {
			shot["stale"] = json.RawMessage(`true`)
		}
	}
	return nil
}
func validateNewApprovals(old, next Record, field string, known map[string]bool) error {
	if err := preserveHistory(old, next, field); err != nil {
		return err
	}
	var before, after []Record
	_ = json.Unmarshal(old[field], &before)
	_ = json.Unmarshal(next[field], &after)
	for _, approval := range after[len(before):] {
		raw, _ := json.Marshal(approval)
		if known[field+":"+jsonKey(raw)] {
			continue
		}
		revisionField := "scriptRevision"
		if field == "planHistory" {
			revisionField = "planRevision"
		}
		if approval.Number("revision") != next.Number(revisionField) {
			return invalid("Approve the current revision")
		}
		if field == "scriptHistory" && approval.Text("script") != next.Text("script") {
			return invalid("Approval script does not match the current script")
		}
		if field == "planHistory" {
			for _, key := range []string{"title", "description", "dialogue", "settingDescription", "creativeNotes", "screenplay"} {
				if approval.Text(key) != next.Text(key) {
					return invalid("Approval plan does not match the current plan")
				}
			}
		}
	}
	return nil
}

func validID(id string) bool {
	if len(id) == 0 || len(id) > 150 || id == "constructor" || id == "prototype" || id == "__proto__" {
		return false
	}
	for i, c := range id {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			continue
		}
		if i > 0 && (c == '-' || c == '_' || c == '.') {
			continue
		}
		return false
	}
	return true
}
