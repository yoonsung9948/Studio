ALTER TABLE projects ADD COLUMN production_revision integer NOT NULL DEFAULT 0, ADD COLUMN details jsonb NOT NULL DEFAULT '{}', ADD COLUMN last_write_hash text, ADD COLUMN deleted_at timestamptz;
CREATE TABLE production_episodes (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 150),
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 parent_id text,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
);
CREATE INDEX production_episodes_project ON production_episodes(owner_user_id,project_id,position) WHERE deleted_at IS NULL;
CREATE TABLE production_scenes (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 150),
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 parent_id text,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
, FOREIGN KEY(parent_id,project_id,owner_user_id) REFERENCES production_episodes(id,project_id,owner_user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX production_scenes_project ON production_scenes(owner_user_id,project_id,position) WHERE deleted_at IS NULL;
CREATE TABLE production_shots (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 150),
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 parent_id text,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
, FOREIGN KEY(parent_id,project_id,owner_user_id) REFERENCES production_scenes(id,project_id,owner_user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX production_shots_project ON production_shots(owner_user_id,project_id,position) WHERE deleted_at IS NULL;
CREATE TABLE production_characters (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 150),
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 parent_id text,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
);
CREATE INDEX production_characters_project ON production_characters(owner_user_id,project_id,position) WHERE deleted_at IS NULL;
CREATE TABLE production_looks (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 150),
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 parent_id text,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
, FOREIGN KEY(parent_id,project_id,owner_user_id) REFERENCES production_characters(id,project_id,owner_user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX production_looks_project ON production_looks(owner_user_id,project_id,position) WHERE deleted_at IS NULL;
CREATE TABLE production_locations (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 150),
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 parent_id text,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
);
CREATE INDEX production_locations_project ON production_locations(owner_user_id,project_id,position) WHERE deleted_at IS NULL;
CREATE TABLE production_props (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 150),
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 parent_id text,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
);
CREATE INDEX production_props_project ON production_props(owner_user_id,project_id,position) WHERE deleted_at IS NULL;
CREATE TABLE production_versions (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 150),
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 parent_id text,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
);
CREATE INDEX production_versions_project ON production_versions(owner_user_id,project_id,position) WHERE deleted_at IS NULL;
CREATE TABLE production_takes (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 150),
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 parent_id text,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
, FOREIGN KEY(parent_id,project_id,owner_user_id) REFERENCES production_shots(id,project_id,owner_user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX production_takes_project ON production_takes(owner_user_id,project_id,position) WHERE deleted_at IS NULL;
CREATE TABLE production_setups (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 150),
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 parent_id text,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
, FOREIGN KEY(parent_id,project_id,owner_user_id) REFERENCES production_scenes(id,project_id,owner_user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX production_setups_project ON production_setups(owner_user_id,project_id,position) WHERE deleted_at IS NULL;
CREATE TABLE production_references (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 150),
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 parent_id text,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
, FOREIGN KEY(parent_id,project_id,owner_user_id) REFERENCES production_characters(id,project_id,owner_user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX production_references_project ON production_references(owner_user_id,project_id,position) WHERE deleted_at IS NULL;
CREATE TABLE production_exports (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 150),
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 parent_id text,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
, FOREIGN KEY(parent_id,project_id,owner_user_id) REFERENCES production_episodes(id,project_id,owner_user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX production_exports_project ON production_exports(owner_user_id,project_id,position) WHERE deleted_at IS NULL;
CREATE TABLE production_media (
 id text PRIMARY KEY,
 project_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 asset_id uuid NOT NULL,
 data jsonb NOT NULL,
 deleted_at timestamptz,
 UNIQUE(id,project_id,owner_user_id),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id),
 FOREIGN KEY(asset_id,owner_user_id) REFERENCES assets(id,owner_user_id)
);
CREATE TABLE production_revisions (
 project_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 revision integer NOT NULL,
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,revision),
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id)
);
ALTER TABLE assets ADD COLUMN deleted_at timestamptz;
