-- Preserve pre-account development data without granting it to a real user.
INSERT INTO users(id,display_name,status)
SELECT '00000000-0000-0000-0000-000000000001','Unassigned legacy data','disabled'
WHERE EXISTS(SELECT 1 FROM projects) OR EXISTS(SELECT 1 FROM jobs) OR EXISTS(SELECT 1 FROM requests);

ALTER TABLE projects ADD COLUMN owner_user_id uuid REFERENCES users(id);
ALTER TABLE jobs ADD COLUMN owner_user_id uuid REFERENCES users(id);
ALTER TABLE requests ADD COLUMN owner_user_id uuid REFERENCES users(id);
UPDATE projects SET owner_user_id='00000000-0000-0000-0000-000000000001';
UPDATE jobs SET owner_user_id='00000000-0000-0000-0000-000000000001';
UPDATE requests SET owner_user_id='00000000-0000-0000-0000-000000000001';
ALTER TABLE projects ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE requests ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE projects ADD CONSTRAINT projects_id_owner UNIQUE(id,owner_user_id);
ALTER TABLE jobs ADD CONSTRAINT jobs_id_owner UNIQUE(id,owner_user_id);
ALTER TABLE jobs ADD CONSTRAINT jobs_project_owner FOREIGN KEY(project_id,owner_user_id)
 REFERENCES projects(id,owner_user_id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE requests ADD CONSTRAINT requests_project_owner FOREIGN KEY(project_id,owner_user_id)
 REFERENCES projects(id,owner_user_id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE requests ADD CONSTRAINT requests_job_owner FOREIGN KEY(interpretation_job_id,owner_user_id)
 REFERENCES jobs(id,owner_user_id) DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE jobs DROP CONSTRAINT generation_jobs_project_id_idempotency_key_key;
DROP INDEX jobs_standalone_idempotency_key;
ALTER TABLE requests DROP CONSTRAINT requests_project_id_idempotency_key_key;
DROP INDEX requests_standalone_idempotency_key;
CREATE UNIQUE INDEX jobs_owner_project_key ON jobs(owner_user_id,project_id,idempotency_key) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX requests_owner_project_key ON requests(owner_user_id,project_id,idempotency_key) NULLS NOT DISTINCT;
CREATE INDEX projects_owner_created ON projects(owner_user_id,created_at DESC,id DESC);
CREATE INDEX jobs_owner_created ON jobs(owner_user_id,created_at DESC,id DESC);
CREATE INDEX requests_owner_created ON requests(owner_user_id,created_at DESC,id DESC);

ALTER TABLE artifacts ADD CONSTRAINT artifacts_id_job UNIQUE(id,producer_job_id);

CREATE TABLE assets (
 id uuid PRIMARY KEY,
 owner_user_id uuid NOT NULL REFERENCES users(id),
 project_id uuid,
 producer_job_id uuid,
 source_artifact_id uuid UNIQUE,
 kind text NOT NULL CHECK(kind IN ('image','video','audio')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_artifact_id IS NULL OR producer_job_id IS NOT NULL),
 FOREIGN KEY(source_artifact_id,producer_job_id) REFERENCES artifacts(id,producer_job_id) DEFERRABLE INITIALLY IMMEDIATE,
 FOREIGN KEY(project_id,owner_user_id) REFERENCES projects(id,owner_user_id) DEFERRABLE INITIALLY IMMEDIATE,
 FOREIGN KEY(producer_job_id,owner_user_id) REFERENCES jobs(id,owner_user_id) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX assets_owner_created ON assets(owner_user_id,created_at DESC,id DESC);
CREATE TABLE asset_files (
 id uuid PRIMARY KEY,
 asset_id uuid NOT NULL REFERENCES assets(id),
 role text NOT NULL CHECK(role IN ('original','thumbnail','preview')),
 storage_key text NOT NULL UNIQUE,
 content_type text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes >= 0),
 UNIQUE(asset_id,role)
);

-- Register existing generated media under the same quarantined owner.
INSERT INTO assets(id,owner_user_id,project_id,producer_job_id,source_artifact_id,kind)
SELECT a.id,j.owner_user_id,j.project_id,j.id,a.id,a.kind
FROM artifacts a JOIN jobs j ON j.id=a.producer_job_id
WHERE a.kind IN ('video','image','audio') AND a.content_json->>'fileKey' IS NOT NULL;
INSERT INTO asset_files(id,asset_id,role,storage_key,content_type,size_bytes)
SELECT a.id,a.id,'original',a.content_json->>'fileKey',
 COALESCE(a.content_json->>'contentType','application/octet-stream'),
 COALESCE((a.content_json->>'sizeBytes')::bigint,0)
FROM artifacts a JOIN assets m ON m.source_artifact_id=a.id;
