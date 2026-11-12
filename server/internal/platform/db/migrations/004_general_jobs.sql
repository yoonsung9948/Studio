ALTER TABLE generation_jobs RENAME TO jobs;

ALTER TABLE jobs ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE artifacts ALTER COLUMN project_id DROP NOT NULL;

-- Preserve project-scoped keys; standalone requests share their own key scope.
CREATE UNIQUE INDEX jobs_standalone_idempotency_key
 ON jobs (idempotency_key) WHERE project_id IS NULL;

-- Local background tasks do not have an AI provider or model.
ALTER TABLE job_attempts ALTER COLUMN provider DROP NOT NULL;
ALTER TABLE job_attempts ALTER COLUMN model DROP NOT NULL;

ALTER INDEX generation_jobs_project_created RENAME TO jobs_project_created;
CREATE INDEX jobs_created_id ON jobs (created_at DESC, id DESC);
