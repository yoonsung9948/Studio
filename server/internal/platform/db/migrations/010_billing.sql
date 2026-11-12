CREATE TABLE credit_wallets (
 owner_user_id uuid PRIMARY KEY REFERENCES users(id),
 available bigint NOT NULL DEFAULT 0,
 reserved bigint NOT NULL DEFAULT 0 CHECK(reserved>=0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE purchases (
 id uuid PRIMARY KEY,
 owner_user_id uuid NOT NULL REFERENCES users(id),
 idempotency_key text NOT NULL,
 pack_id text NOT NULL,
 credits bigint NOT NULL CHECK(credits>0),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 currency text NOT NULL,
 provider text NOT NULL,
 provider_session_id text UNIQUE,
 checkout_url text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed','cancelled','refunded')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_user_id,idempotency_key),
 UNIQUE(id,owner_user_id)
);
CREATE INDEX purchases_owner_created ON purchases(owner_user_id,created_at DESC,id DESC);
CREATE TABLE payment_events (
 provider text NOT NULL,
 event_id text NOT NULL,
 payload jsonb NOT NULL,
 available_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,event_id)
);
CREATE INDEX payment_events_pending ON payment_events(available_at) WHERE processed_at IS NULL;
CREATE TABLE credit_reservations (
 job_id uuid PRIMARY KEY,
 owner_user_id uuid NOT NULL,
 credits bigint NOT NULL CHECK(credits>0),
 operation text NOT NULL,
 pricing_version integer NOT NULL,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','captured','released')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(job_id,owner_user_id) REFERENCES jobs(id,owner_user_id)
);
CREATE TABLE credit_entries (
 id uuid PRIMARY KEY,
 owner_user_id uuid NOT NULL REFERENCES users(id),
 reference text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('grant','reserve','capture','release','refund','adjustment')),
 available_delta bigint NOT NULL,
 reserved_delta bigint NOT NULL,
 available_after bigint NOT NULL,
 reserved_after bigint NOT NULL CHECK(reserved_after>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_user_id,reference),
 CHECK(available_delta<>0 OR reserved_delta<>0)
);
CREATE INDEX credit_entries_owner_created ON credit_entries(owner_user_id,created_at DESC,id DESC);
CREATE FUNCTION protect_credit_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'credit entries are append-only'; END $$;
CREATE TRIGGER credit_history_immutable BEFORE UPDATE OR DELETE ON credit_entries FOR EACH ROW EXECUTE FUNCTION protect_credit_history();
