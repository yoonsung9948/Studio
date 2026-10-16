CREATE TABLE projects (
 id uuid PRIMARY KEY,
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE generation_jobs (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id),
 operation text NOT NULL,
 input_schema_version integer NOT NULL CHECK (input_schema_version > 0),
 input_json jsonb NOT NULL,
 idempotency_key text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
 river_job_id bigint NOT NULL UNIQUE,
 active_attempt integer NOT NULL DEFAULT 0,
 error_code text,
 error_message text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (project_id, idempotency_key)
);

CREATE TABLE job_attempts (
 job_id uuid NOT NULL REFERENCES generation_jobs(id),
 number integer NOT NULL CHECK (number > 0),
 provider text NOT NULL,
 model text NOT NULL,
 status text NOT NULL CHECK (status IN ('running','succeeded','failed','interrupted')),
 provider_request_id text,
 provider_task_id text,
 error_code text,
 error_message text,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 PRIMARY KEY (job_id, number)
);

CREATE TABLE artifacts (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id),
 producer_job_id uuid NOT NULL UNIQUE REFERENCES generation_jobs(id),
 kind text NOT NULL,
 schema_version integer NOT NULL CHECK (schema_version > 0),
 content_json jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX generation_jobs_project_created ON generation_jobs (project_id, created_at DESC);
