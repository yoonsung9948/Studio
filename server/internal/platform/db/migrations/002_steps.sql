-- Multi-step operations: a job remembers its current step and the state that
-- step saved, so it can wait on a provider or move to another queue and resume.
ALTER TABLE generation_jobs
 ADD COLUMN step text NOT NULL DEFAULT '',
 ADD COLUMN state jsonb,
 -- lease identifies the execution allowed to write results; a newer claim replaces it.
 ADD COLUMN lease uuid,
 -- continuing is true between a Wait/Next checkpoint and the execution that resumes it,
 -- so that execution continues the same attempt instead of starting a new one.
 ADD COLUMN continuing boolean NOT NULL DEFAULT false;

-- A job may produce several artifacts, ordered by position.
ALTER TABLE artifacts DROP CONSTRAINT artifacts_producer_job_id_key;
ALTER TABLE artifacts ADD COLUMN position integer NOT NULL DEFAULT 0 CHECK (position >= 0);
ALTER TABLE artifacts ADD CONSTRAINT artifacts_producer_position_key UNIQUE (producer_job_id, position);
