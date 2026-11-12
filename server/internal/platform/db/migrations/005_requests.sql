CREATE TABLE requests (
 id uuid PRIMARY KEY,
 project_id uuid REFERENCES projects(id),
 prompt text NOT NULL,
 idempotency_key text NOT NULL,
 interpretation_job_id uuid NOT NULL UNIQUE REFERENCES jobs(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (project_id, idempotency_key)
);
CREATE UNIQUE INDEX requests_standalone_idempotency_key
 ON requests (idempotency_key) WHERE project_id IS NULL;
