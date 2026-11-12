CREATE TABLE image_provider_calls (
 job_id uuid PRIMARY KEY REFERENCES jobs(id),
 input_hash text NOT NULL,
 model text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','retryable','completed','failed')),
 submissions integer NOT NULL DEFAULT 1 CHECK(submissions BETWEEN 1 AND 3),
 request_id text,
 metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
