CREATE TABLE library_places (
 id uuid PRIMARY KEY,
 owner_user_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL,
 description text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 UNIQUE(id,owner_user_id)
);
CREATE TABLE library_props (
 id uuid PRIMARY KEY,
 owner_user_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL,
 description text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 UNIQUE(id,owner_user_id)
);
CREATE TABLE reference_image_versions (
 id uuid PRIMARY KEY,
 owner_user_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('place','prop','look','cast','place_instance','prop_instance')),
 subject_id text NOT NULL,
 view text NOT NULL,
 subject_revision integer NOT NULL,
 identity_version_id text,
 front_version_id text,
 asset_id uuid NOT NULL,
 producer_job_id uuid UNIQUE,
 approval text NOT NULL DEFAULT 'needs_review' CHECK(approval IN ('needs_review','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(asset_id,owner_user_id) REFERENCES assets(id,owner_user_id),
 FOREIGN KEY(producer_job_id,owner_user_id) REFERENCES jobs(id,owner_user_id),
 UNIQUE(id,owner_user_id,kind,subject_id,view)
);
CREATE TABLE reference_selections (
 owner_user_id uuid NOT NULL,
 kind text NOT NULL,
 subject_id text NOT NULL,
 view text NOT NULL,
 version_id uuid NOT NULL,
 PRIMARY KEY(owner_user_id,kind,subject_id,view),
 FOREIGN KEY(version_id,owner_user_id,kind,subject_id,view) REFERENCES reference_image_versions(id,owner_user_id,kind,subject_id,view)
);
CREATE TABLE reference_batches (
 id uuid PRIMARY KEY,
 owner_user_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL,
 subject_id text NOT NULL,
 idempotency_key text NOT NULL,
 input_json jsonb NOT NULL,
 UNIQUE(owner_user_id,kind,subject_id,idempotency_key)
);
CREATE TABLE reference_generations (
 job_id uuid PRIMARY KEY,
 owner_user_id uuid NOT NULL,
 batch_id uuid NOT NULL REFERENCES reference_batches(id),
 kind text NOT NULL,
 subject_id text NOT NULL,
 view text NOT NULL,
 subject_revision integer NOT NULL,
 identity_version_id text,
 front_version_id text,
 FOREIGN KEY(job_id,owner_user_id) REFERENCES jobs(id,owner_user_id)
);
CREATE TABLE production_generation_jobs (
 job_id uuid PRIMARY KEY,
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 shot_id text NOT NULL,
 shot_revision integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('image','video')),
 snapshot jsonb NOT NULL,
 FOREIGN KEY(job_id,owner_user_id) REFERENCES jobs(id,owner_user_id),
 FOREIGN KEY(shot_id,project_id,owner_user_id) REFERENCES production_shots(id,project_id,owner_user_id)
);
CREATE TABLE media_uploads (
 owner_user_id uuid NOT NULL REFERENCES users(id),
 idempotency_key text NOT NULL,
 sha256 text NOT NULL,
 asset_id uuid NOT NULL,
 PRIMARY KEY(owner_user_id,idempotency_key),
 FOREIGN KEY(asset_id,owner_user_id) REFERENCES assets(id,owner_user_id)
);
CREATE TABLE blob_deletions (
 storage_key text PRIMARY KEY,
 owner_user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE TABLE production_generation_batches (
 owner_user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 shot_id text NOT NULL,
 idempotency_key text NOT NULL,
 input_json jsonb NOT NULL,
 PRIMARY KEY(owner_user_id,project_id,idempotency_key),
 FOREIGN KEY(shot_id,project_id,owner_user_id) REFERENCES production_shots(id,project_id,owner_user_id)
);
