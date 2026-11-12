package production

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/apperr"
)

type Service struct {
	pool *pgxpool.Pool
	jobs *engine.JobService
}

func NewService(pool *pgxpool.Pool, jobs ...*engine.JobService) *Service {
	s := &Service{pool: pool}
	if len(jobs) > 0 {
		s.jobs = jobs[0]
	}
	return s
}
func (s *Service) Get(ctx context.Context, owner, id string) (Document, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Document{}, err
	}
	defer tx.Rollback(ctx)
	result, err := load(ctx, tx, owner, id)
	if err != nil {
		return Document{}, err
	}
	return result, tx.Commit(ctx)
}
func load(ctx context.Context, tx pgx.Tx, owner, id string) (Document, error) {
	d := Document{}
	var raw json.RawMessage
	var title string
	err := tx.QueryRow(ctx, `SELECT production_revision,details,title FROM projects WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, id, owner).Scan(&d.Revision, &raw, &title)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, apperr.ErrNotFound
	}
	if err != nil {
		return d, err
	}
	if json.Unmarshal(raw, &d.Project) != nil || d.Project == nil {
		d.Project = Record{}
	}
	if d.Revision == 0 {
		raw, _ = json.Marshal(map[string]any{"id": id, "title": title, "description": "", "cover": "", "episodeIds": []string{}, "bible": "", "defaultDuration": 6, "revision": 1})
		_ = json.Unmarshal(raw, &d.Project)
	}
	lists := []*[]Record{&d.Episodes, &d.Scenes, &d.Shots, &d.Characters, &d.Looks, &d.Locations, &d.Props, &d.Versions, &d.Takes, &d.Setups, &d.References, &d.Exports}
	for i, g := range d.groups() {
		suffix := ""
		if g.name == "takes" {
			suffix = ` AND EXISTS(SELECT 1 FROM production_shots s WHERE s.id=production_takes.parent_id AND s.project_id=production_takes.project_id AND s.owner_user_id=production_takes.owner_user_id AND s.deleted_at IS NULL)`
		}
		rows, err := tx.Query(ctx, `SELECT data FROM production_`+g.name+` WHERE project_id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`+suffix+` ORDER BY position,id`, id, owner)
		if err != nil {
			return d, err
		}
		items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Record, error) {
			var raw []byte
			err := row.Scan(&raw)
			var record Record
			if err == nil {
				err = json.Unmarshal(raw, &record)
			}
			return record, err
		})
		if err != nil {
			return d, err
		}
		*lists[i] = items
		if *lists[i] == nil {
			*lists[i] = []Record{}
		}
	}
	rows, err := tx.Query(ctx, `SELECT data FROM production_media WHERE project_id=$1 AND owner_user_id=$2 AND deleted_at IS NULL ORDER BY id`, id, owner)
	if err != nil {
		return d, err
	}
	d.Assets, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Record, error) {
		var raw []byte
		err := row.Scan(&raw)
		var record Record
		if err == nil {
			err = json.Unmarshal(raw, &record)
		}
		return record, err
	})
	if d.Assets == nil {
		d.Assets = []Record{}
	}
	return d, err
}
func (s *Service) Save(ctx context.Context, owner, id string, d Document) (Document, error) {
	if err := d.Validate(id); err != nil {
		return Document{}, err
	}
	raw, err := json.Marshal(d)
	if err != nil {
		return Document{}, err
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(raw))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Document{}, err
	}
	defer tx.Rollback(ctx)
	var revision int
	var previous *string
	err = tx.QueryRow(ctx, `SELECT production_revision,last_write_hash FROM projects WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL FOR NO KEY UPDATE`, id, owner).Scan(&revision, &previous)
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, apperr.ErrNotFound
	}
	if err != nil {
		return Document{}, err
	}
	if revision != d.Revision {
		if previous != nil && *previous == hash {
			saved, err := load(ctx, tx, owner, id)
			if err != nil {
				return Document{}, err
			}
			return saved, tx.Commit(ctx)
		}
		return Document{}, &apperr.ConflictError{Code: "revision_conflict", Message: "This production changed in another session. Reload before saving."}
	}
	old, err := load(ctx, tx, owner, id)
	if err != nil {
		return Document{}, err
	}
	knownApprovals := map[string]bool{}
	for _, set := range []struct {
		records []Record
		field   string
	}{{old.Episodes, "scriptHistory"}, {old.Scenes, "planHistory"}} {
		for _, record := range set.records {
			var entries []json.RawMessage
			_ = json.Unmarshal(record[set.field], &entries)
			for _, entry := range entries {
				knownApprovals[set.field+":"+jsonKey(entry)] = true
			}
		}
	}

	activeShots := map[string]bool{}
	for _, shot := range d.Shots {
		activeShots[shot.Text("id")] = true
	}
	history := []Record{}
	for _, take := range old.Takes {
		if activeShots[take.Text("shotId")] {
			history = append(history, take)
		}
	}
	d.Takes = mergeRecords(d.Takes, history)
	d.Versions = mergeRecords(d.Versions, old.Versions)
	d.Assets = mergeRecords(d.Assets, old.Assets)
	for _, character := range d.Characters {
		if source := character.Text("sourceCharacterId"); source != "" {
			var found bool
			err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM characters WHERE id::text=$1 AND owner_user_id=$2 UNION ALL SELECT 1 FROM production_characters WHERE id=$1 AND owner_user_id=$2)`, source, owner).Scan(&found)
			if err != nil {
				return Document{}, err
			}
			if !found {
				return Document{}, apperr.ErrNotFound
			}
		}
	}
	for _, asset := range d.Assets {
		var found bool
		err = tx.QueryRow(ctx, `SELECT true FROM assets WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL FOR SHARE`, asset.Text("serverAssetId"), owner).Scan(&found)
		if errors.Is(err, pgx.ErrNoRows) {
			return Document{}, apperr.ErrNotFound
		}
		if err != nil {
			return Document{}, invalid("Invalid stored asset")
		}
		encoded, _ := json.Marshal(asset)
		tag, err := tx.Exec(ctx, `INSERT INTO production_media(id,project_id,owner_user_id,asset_id,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,deleted_at=NULL WHERE production_media.project_id=$2 AND production_media.owner_user_id=$3 AND production_media.asset_id=EXCLUDED.asset_id`, asset.Text("id"), id, owner, asset.Text("serverAssetId"), encoded)
		if err != nil {
			return Document{}, err
		}
		if tag.RowsAffected() != 1 {
			return Document{}, apperr.ErrNotFound
		}
	}
	for i, g := range d.groups() {
		before := map[string]Record{}
		for _, record := range old.groups()[i].records {
			before[record.Text("id")] = record
		}
		ids := []string{}
		for position, record := range g.records {
			if order := d.order(g.name, record); order >= 0 {
				position = order
			}
			key := record.Text("id")
			ids = append(ids, key)
			if g.name == "episodes" {
				if err := validateNewApprovals(before[key], record, "scriptHistory", knownApprovals); err != nil {
					return Document{}, err
				}
			}
			if g.name == "scenes" {
				if err := validateNewApprovals(before[key], record, "planHistory", knownApprovals); err != nil {
					return Document{}, err
				}
			}
			if g.name == "takes" && before[key] == nil && record.Text("producerJobId") != "" {
				var snapshot json.RawMessage
				err := tx.QueryRow(ctx, `SELECT g.snapshot FROM production_generation_jobs g JOIN assets a ON a.producer_job_id=g.job_id AND a.owner_user_id=g.owner_user_id JOIN production_media m ON m.asset_id=a.id AND m.owner_user_id=a.owner_user_id WHERE g.job_id=$1 AND g.owner_user_id=$2 AND m.id=$3 AND m.project_id=$4`, record.Text("producerJobId"), owner, record.Text("assetId"), id).Scan(&snapshot)
				if errors.Is(err, pgx.ErrNoRows) {
					return Document{}, apperr.ErrNotFound
				}
				if err != nil {
					return Document{}, err
				}
				var input Record
				_ = json.Unmarshal(snapshot, &input)
				references := input["_references"]
				delete(input, "_references")
				if len(record["inputs"]) == 0 {
					record["inputs"], _ = json.Marshal(input)
				}
				if len(record["references"]) == 0 {
					if len(references) == 0 || string(references) == "null" {
						references = json.RawMessage(`[]`)
					}
					record["references"] = references
				}
			}
			if previous := before[key]; previous != nil {
				if g.name == "takes" || g.name == "versions" {
					for _, field := range []string{"assetId", "revision", "inputs", "references", "sourceIdentityVersionId", "sourceLookVersionId", "sourceTakeId", "shotId", "sourceFrames", "createdAt", "producerJobId", "kind", "ownerKind", "ownerId", "viewType"} {
						if (field == "inputs" || field == "references") && len(record[field]) == 0 {
							record[field] = previous[field]
						}
						if !equalJSON(previous[field], record[field]) {
							return Document{}, invalid("Generated source snapshots are immutable")
						}
					}
				}
			}
			data, _ := json.Marshal(record)
			parent := record.Text(g.parentField)
			var parentID *string
			if parent != "" {
				parentID = &parent
			}
			tag, err := tx.Exec(ctx, `INSERT INTO production_`+g.name+`(id,owner_user_id,project_id,parent_id,position,revision,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET parent_id=EXCLUDED.parent_id,position=EXCLUDED.position,revision=EXCLUDED.revision,data=EXCLUDED.data,deleted_at=NULL WHERE production_`+g.name+`.owner_user_id=$2 AND production_`+g.name+`.project_id=$3`, key, owner, id, parentID, position, max(record.Number("revision"), 1), data)
			if err != nil {
				return Document{}, err
			}
			if tag.RowsAffected() != 1 {
				return Document{}, apperr.ErrNotFound
			}
		}
		if g.name == "takes" || g.name == "versions" {
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE production_`+g.name+` SET deleted_at=now() WHERE project_id=$1 AND owner_user_id=$2 AND NOT(id=ANY($3::text[])) AND deleted_at IS NULL`, id, owner, ids); err != nil {
			return Document{}, err
		}
	}

	d.Revision = revision + 1
	project, _ := json.Marshal(d.Project)
	if _, err := tx.Exec(ctx, `UPDATE projects SET details=$3,title=$4,production_revision=$5,last_write_hash=$6 WHERE id=$1 AND owner_user_id=$2`, id, owner, project, d.Project.Text("title"), d.Revision, hash); err != nil {
		return Document{}, err
	}
	snapshot, _ := json.Marshal(d)
	if _, err := tx.Exec(ctx, `INSERT INTO production_revisions(project_id,owner_user_id,revision,snapshot) VALUES($1,$2,$3,$4)`, id, owner, d.Revision, snapshot); err != nil {
		return Document{}, err
	}
	return d, tx.Commit(ctx)
}
func (s *Service) Delete(ctx context.Context, owner, id string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE projects SET deleted_at=now() WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, id, owner)
	if err == nil && tag.RowsAffected() == 0 {
		return apperr.ErrNotFound
	}
	return err
}

func mergeRecords(current, history []Record) []Record {
	seen := map[string]bool{}
	for _, r := range current {
		seen[r.Text("id")] = true
	}
	for _, r := range history {
		if !seen[r.Text("id")] {
			current = append(current, r)
		}
	}
	return current
}

func (d Document) order(kind string, record Record) int {
	var ids []string
	switch kind {
	case "episodes":
		ids = d.Project.Strings("episodeIds")
	case "scenes":
		for _, p := range d.Episodes {
			if p.Text("id") == record.Text("episodeId") {
				ids = p.Strings("sceneIds")
			}
		}
	case "shots":
		for _, p := range d.Scenes {
			if p.Text("id") == record.Text("sceneId") {
				ids = p.Strings("shotIds")
			}
		}
	}
	for i, id := range ids {
		if id == record.Text("id") {
			return i
		}
	}
	return -1
}

func equalJSON(a, b json.RawMessage) bool {
	var x, y any
	_ = json.Unmarshal(a, &x)
	_ = json.Unmarshal(b, &y)
	left, _ := json.Marshal(x)
	right, _ := json.Marshal(y)
	return string(left) == string(right)
}

func jsonKey(raw json.RawMessage) string {
	var value any
	_ = json.Unmarshal(raw, &value)
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
