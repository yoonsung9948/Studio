CREATE TABLE characters (
 id uuid PRIMARY KEY,
 owner_user_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 appearance text NOT NULL DEFAULT '' CHECK(length(appearance)<=3000),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 appearance_revision integer NOT NULL DEFAULT 1 CHECK(appearance_revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 UNIQUE(id,owner_user_id)
);
CREATE INDEX characters_owner_created ON characters(owner_user_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;

CREATE TABLE character_image_versions (
 id uuid PRIMARY KEY,
 character_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 view text NOT NULL CHECK(view IN ('front','three_quarter','profile','right_profile','full_body','back')),
 asset_id uuid NOT NULL,
 producer_job_id uuid,
 appearance_revision integer NOT NULL CHECK(appearance_revision>0),
 source_identity_version_id uuid,
 prompt text NOT NULL,
 upload_key text,
 upload_sha256 text,
 CHECK((upload_key IS NULL)=(upload_sha256 IS NULL)),
 approval text NOT NULL DEFAULT 'needs_review' CHECK(approval IN ('needs_review','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((view='front' AND source_identity_version_id IS NULL) OR (view<>'front' AND source_identity_version_id IS NOT NULL)),
 UNIQUE(id,character_id,owner_user_id),
 UNIQUE(id,character_id,view,owner_user_id),
 UNIQUE(producer_job_id),
 FOREIGN KEY(character_id,owner_user_id) REFERENCES characters(id,owner_user_id),
 FOREIGN KEY(asset_id,owner_user_id) REFERENCES assets(id,owner_user_id),
 FOREIGN KEY(producer_job_id,owner_user_id) REFERENCES jobs(id,owner_user_id),
 FOREIGN KEY(source_identity_version_id,character_id,owner_user_id) REFERENCES character_image_versions(id,character_id,owner_user_id)
);
CREATE UNIQUE INDEX character_upload_key ON character_image_versions(owner_user_id,character_id,upload_key) WHERE upload_key IS NOT NULL;
CREATE INDEX character_versions_created ON character_image_versions(owner_user_id,character_id,created_at DESC,id DESC);

CREATE TABLE character_views (
 character_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 view text NOT NULL CHECK(view IN ('front','three_quarter','profile','right_profile','full_body','back')),
 selected_version_id uuid,
 PRIMARY KEY(character_id,view),
 FOREIGN KEY(character_id,owner_user_id) REFERENCES characters(id,owner_user_id),
 FOREIGN KEY(selected_version_id,character_id,view,owner_user_id) REFERENCES character_image_versions(id,character_id,view,owner_user_id)
);

CREATE TABLE character_generation_batches (
 id uuid PRIMARY KEY,
 character_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 idempotency_key text NOT NULL,
 input_json jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_user_id,character_id,idempotency_key),
 UNIQUE(id,character_id,owner_user_id),
 FOREIGN KEY(character_id,owner_user_id) REFERENCES characters(id,owner_user_id)
);
CREATE TABLE character_generations (
 job_id uuid PRIMARY KEY,
 batch_id uuid NOT NULL,
 character_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 position integer NOT NULL CHECK(position>=0),
 view text NOT NULL CHECK(view IN ('front','three_quarter','profile','right_profile','full_body','back')),
 appearance_revision integer NOT NULL CHECK(appearance_revision>0),
 source_identity_version_id uuid,
 prompt text NOT NULL,
 CHECK((view='front' AND source_identity_version_id IS NULL) OR (view<>'front' AND source_identity_version_id IS NOT NULL)),
 UNIQUE(batch_id,position),
 FOREIGN KEY(job_id,owner_user_id) REFERENCES jobs(id,owner_user_id),
 FOREIGN KEY(batch_id,character_id,owner_user_id) REFERENCES character_generation_batches(id,character_id,owner_user_id),
 FOREIGN KEY(source_identity_version_id,character_id,owner_user_id) REFERENCES character_image_versions(id,character_id,owner_user_id)
);
