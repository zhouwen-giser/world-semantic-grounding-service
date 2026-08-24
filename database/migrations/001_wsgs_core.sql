CREATE SCHEMA IF NOT EXISTS wsgs;

CREATE TABLE IF NOT EXISTS wsgs.schema_migration (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS wsgs.grounding_request (
  grounding_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  data_scope TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_text_sha256 TEXT NOT NULL CHECK (source_text_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  source_text_ciphertext BYTEA,
  source_expires_at TIMESTAMPTZ NOT NULL,
  request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (data_scope, request_id)
);

CREATE TABLE IF NOT EXISTS wsgs.grounding_job (
  job_id TEXT PRIMARY KEY,
  grounding_id TEXT NOT NULL UNIQUE REFERENCES wsgs.grounding_request(grounding_id) ON DELETE CASCADE,
  data_scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'ACCEPTED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'AMBIGUOUS',
    'UNRESOLVED', 'FAILED', 'CANCELLED'
  )),
  available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deadline_at TIMESTAMPTZ NOT NULL,
  lease_token TEXT,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS grounding_job_claim_idx
  ON wsgs.grounding_job (available_at, created_at)
  WHERE status IN ('ACCEPTED', 'RUNNING') AND cancel_requested_at IS NULL;
CREATE INDEX IF NOT EXISTS grounding_job_scope_idx
  ON wsgs.grounding_job (data_scope, grounding_id);

CREATE TABLE IF NOT EXISTS wsgs.idempotency (
  data_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  grounding_id TEXT NOT NULL REFERENCES wsgs.grounding_request(grounding_id) ON DELETE CASCADE,
  result_bytes BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (data_scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS wsgs.semantic_frame (
  grounding_id TEXT PRIMARY KEY REFERENCES wsgs.grounding_request(grounding_id) ON DELETE CASCADE,
  data_scope TEXT NOT NULL,
  frame JSONB NOT NULL,
  frame_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS wsgs.grounding_graph (
  grounding_id TEXT PRIMARY KEY REFERENCES wsgs.grounding_request(grounding_id) ON DELETE CASCADE,
  data_scope TEXT NOT NULL,
  graph JSONB NOT NULL,
  graph_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS wsgs.world_query (
  query_id TEXT PRIMARY KEY,
  grounding_id TEXT NOT NULL REFERENCES wsgs.grounding_request(grounding_id) ON DELETE CASCADE,
  data_scope TEXT NOT NULL,
  plan JSONB NOT NULL,
  plan_hash TEXT NOT NULL,
  upstream_job_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS wsgs.grounding_result (
  grounding_id TEXT PRIMARY KEY REFERENCES wsgs.grounding_request(grounding_id) ON DELETE CASCADE,
  data_scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'PARTIAL', 'AMBIGUOUS', 'UNRESOLVED', 'FAILED', 'CANCELLED')),
  result_hash TEXT NOT NULL CHECK (result_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_bytes BYTEA NOT NULL,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS wsgs.result_product (
  product_id TEXT PRIMARY KEY,
  grounding_id TEXT NOT NULL REFERENCES wsgs.grounding_result(grounding_id) ON DELETE CASCADE,
  data_scope TEXT NOT NULL,
  product_kind TEXT NOT NULL,
  payload JSONB,
  payload_ref TEXT,
  payload_hash TEXT NOT NULL,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((payload IS NULL) <> (payload_ref IS NULL))
);

CREATE TABLE IF NOT EXISTS wsgs.capability_snapshot (
  snapshot_id TEXT PRIMARY KEY,
  grounding_id TEXT REFERENCES wsgs.grounding_request(grounding_id) ON DELETE SET NULL,
  data_scope TEXT NOT NULL,
  catalog_hash TEXT NOT NULL,
  catalog JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS wsgs.model_receipt (
  receipt_id TEXT PRIMARY KEY,
  grounding_id TEXT NOT NULL REFERENCES wsgs.grounding_request(grounding_id) ON DELETE CASCADE,
  data_scope TEXT NOT NULL,
  model_name_hash TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  schema_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_hash TEXT,
  status TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION wsgs.enforce_grounding_job_terminal_monotonic()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('COMPLETED', 'PARTIAL', 'AMBIGUOUS', 'UNRESOLVED', 'FAILED', 'CANCELLED')
     AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'terminal grounding job status cannot change from % to %', OLD.status, NEW.status;
  END IF;
  IF OLD.cancel_requested_at IS NOT NULL AND NEW.status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'cancelled grounding job cannot accept a late result';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grounding_job_terminal_monotonic ON wsgs.grounding_job;
CREATE TRIGGER grounding_job_terminal_monotonic
BEFORE UPDATE ON wsgs.grounding_job
FOR EACH ROW EXECUTE FUNCTION wsgs.enforce_grounding_job_terminal_monotonic();

