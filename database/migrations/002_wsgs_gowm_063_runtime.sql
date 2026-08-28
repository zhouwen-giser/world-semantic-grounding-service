ALTER TABLE wsgs.schema_migration
  ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT;

ALTER TABLE wsgs.grounding_request
  ADD COLUMN IF NOT EXISTS actor_id TEXT,
  ADD COLUMN IF NOT EXISTS dataset_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS authorization_context_hash TEXT,
  ADD COLUMN IF NOT EXISTS gowm_contract_catalog_revision TEXT,
  ADD COLUMN IF NOT EXISTS gowm_semantic_catalog_hash TEXT,
  ADD COLUMN IF NOT EXISTS gowm_consumer_package_integrity TEXT,
  ADD COLUMN IF NOT EXISTS gowm_operation_lock_hash TEXT;

UPDATE wsgs.grounding_request
   SET actor_id = principal_id
 WHERE actor_id IS NULL;
UPDATE wsgs.grounding_request
   SET authorization_context_hash = 'sha256:' || repeat('0', 64)
 WHERE authorization_context_hash IS NULL;

ALTER TABLE wsgs.grounding_request
  ALTER COLUMN actor_id SET NOT NULL,
  ALTER COLUMN authorization_context_hash SET NOT NULL;

ALTER TABLE wsgs.grounding_request
  DROP CONSTRAINT IF EXISTS grounding_request_data_scope_request_id_key;
ALTER TABLE wsgs.grounding_request
  ADD CONSTRAINT grounding_request_scope_actor_request_key
  UNIQUE (data_scope, actor_id, request_id);

ALTER TABLE wsgs.grounding_request
  DROP CONSTRAINT IF EXISTS grounding_request_authorization_context_hash_check;
ALTER TABLE wsgs.grounding_request
  ADD CONSTRAINT grounding_request_authorization_context_hash_check
  CHECK (authorization_context_hash ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE wsgs.grounding_request
  DROP CONSTRAINT IF EXISTS grounding_request_gowm_contract_catalog_revision_check;
ALTER TABLE wsgs.grounding_request
  ADD CONSTRAINT grounding_request_gowm_contract_catalog_revision_check
  CHECK (gowm_contract_catalog_revision IS NULL OR gowm_contract_catalog_revision ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE wsgs.grounding_request
  DROP CONSTRAINT IF EXISTS grounding_request_gowm_semantic_catalog_hash_check;
ALTER TABLE wsgs.grounding_request
  ADD CONSTRAINT grounding_request_gowm_semantic_catalog_hash_check
  CHECK (gowm_semantic_catalog_hash IS NULL OR gowm_semantic_catalog_hash ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE wsgs.grounding_request
  DROP CONSTRAINT IF EXISTS grounding_request_gowm_consumer_package_integrity_check;
ALTER TABLE wsgs.grounding_request
  ADD CONSTRAINT grounding_request_gowm_consumer_package_integrity_check
  CHECK (gowm_consumer_package_integrity IS NULL OR gowm_consumer_package_integrity ~ '^sha512-[A-Za-z0-9+/]+={0,2}$');
ALTER TABLE wsgs.grounding_request
  DROP CONSTRAINT IF EXISTS grounding_request_gowm_operation_lock_hash_check;
ALTER TABLE wsgs.grounding_request
  ADD CONSTRAINT grounding_request_gowm_operation_lock_hash_check
  CHECK (gowm_operation_lock_hash IS NULL OR gowm_operation_lock_hash ~ '^sha256:[0-9a-f]{64}$');

ALTER TABLE wsgs.grounding_job
  ADD COLUMN IF NOT EXISTS actor_id TEXT,
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT,
  ADD COLUMN IF NOT EXISTS stage_generation INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stage_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stage_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_result_bytes INTEGER NOT NULL DEFAULT 67108864,
  ADD COLUMN IF NOT EXISTS immutable_locks JSONB;

UPDATE wsgs.grounding_job AS job
   SET actor_id = request.actor_id
  FROM wsgs.grounding_request AS request
 WHERE request.grounding_id = job.grounding_id
   AND job.actor_id IS NULL;

ALTER TABLE wsgs.grounding_job
  ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE wsgs.grounding_job
  DROP CONSTRAINT IF EXISTS grounding_job_stage_generation_check;
ALTER TABLE wsgs.grounding_job
  ADD CONSTRAINT grounding_job_stage_generation_check CHECK (stage_generation >= 1);
ALTER TABLE wsgs.grounding_job
  DROP CONSTRAINT IF EXISTS grounding_job_max_result_bytes_check;
ALTER TABLE wsgs.grounding_job
  ADD CONSTRAINT grounding_job_max_result_bytes_check
  CHECK (max_result_bytes BETWEEN 1024 AND 67108864);
ALTER TABLE wsgs.grounding_job
  DROP CONSTRAINT IF EXISTS grounding_job_pipeline_stage_check;
ALTER TABLE wsgs.grounding_job
  ADD CONSTRAINT grounding_job_pipeline_stage_check CHECK (
    pipeline_stage IS NULL OR pipeline_stage IN (
      'LOAD_CONTEXT', 'DETERMINISTIC_PARSE', 'SEMANTIC_MODEL_PARSE',
      'SEMANTIC_FRAME_VALIDATE', 'GROUNDING_GRAPH_BUILD', 'REFERENCE_RESOLVE',
      'REFERENCE_VALIDATE', 'REQUIREMENT_PLAN', 'CAPABILITY_MATCH',
      'WORLD_QUERY_COMPILE', 'GOWM_EXECUTE', 'EVIDENCE_NORMALIZE',
      'PRODUCT_ASSEMBLE', 'RESULT_PERSIST'
    )
  );

CREATE INDEX IF NOT EXISTS grounding_job_scope_actor_idx
  ON wsgs.grounding_job (data_scope, actor_id, grounding_id);

ALTER TABLE wsgs.idempotency
  ADD COLUMN IF NOT EXISTS actor_id TEXT;
UPDATE wsgs.idempotency AS item
   SET actor_id = request.actor_id
  FROM wsgs.grounding_request AS request
 WHERE request.grounding_id = item.grounding_id
   AND item.actor_id IS NULL;
ALTER TABLE wsgs.idempotency
  ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE wsgs.idempotency
  DROP CONSTRAINT IF EXISTS idempotency_pkey;
ALTER TABLE wsgs.idempotency
  ADD CONSTRAINT idempotency_pkey PRIMARY KEY (data_scope, actor_id, idempotency_key);

ALTER TABLE wsgs.grounding_result
  ADD COLUMN IF NOT EXISTS actor_id TEXT;
UPDATE wsgs.grounding_result AS result
   SET actor_id = request.actor_id
  FROM wsgs.grounding_request AS request
 WHERE request.grounding_id = result.grounding_id
   AND result.actor_id IS NULL;
ALTER TABLE wsgs.grounding_result
  ALTER COLUMN actor_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS grounding_result_scope_actor_idx
  ON wsgs.grounding_result (data_scope, actor_id, grounding_id);

ALTER TABLE wsgs.capability_snapshot
  ADD COLUMN IF NOT EXISTS contract_catalog_revision TEXT,
  ADD COLUMN IF NOT EXISTS semantic_catalog_hash TEXT,
  ADD COLUMN IF NOT EXISTS binding_revision TEXT,
  ADD COLUMN IF NOT EXISTS availability_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS availability_hash TEXT,
  ADD COLUMN IF NOT EXISTS operation_lock_hash TEXT,
  ADD COLUMN IF NOT EXISTS consumer_package_integrity TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_hash TEXT;

ALTER TABLE wsgs.world_query
  ADD COLUMN IF NOT EXISTS gateway_query_id TEXT,
  ADD COLUMN IF NOT EXISTS gateway_job_id TEXT,
  ADD COLUMN IF NOT EXISTS query_snapshot_manifest JSONB,
  ADD COLUMN IF NOT EXISTS snapshot_adherence JSONB,
  ADD COLUMN IF NOT EXISTS upstream_status TEXT,
  ADD COLUMN IF NOT EXISTS upstream_result_hash TEXT;

CREATE TABLE IF NOT EXISTS wsgs.gowm_execution (
  execution_id TEXT PRIMARY KEY,
  grounding_id TEXT NOT NULL REFERENCES wsgs.grounding_request(grounding_id) ON DELETE CASCADE,
  data_scope TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  execution_kind TEXT NOT NULL CHECK (execution_kind IN ('DIRECT_OPERATION', 'WORLD_QUERY', 'WORLD_QUERY_NODE')),
  operation_id TEXT,
  operation_version TEXT,
  gateway_query_id TEXT,
  gateway_job_id TEXT,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_hash TEXT CHECK (result_hash IS NULL OR result_hash ~ '^sha256:[0-9a-f]{64}$'),
  normalized_status TEXT NOT NULL CHECK (normalized_status IN (
    'COMPLETED', 'PARTIAL', 'NO_DATA', 'AMBIGUOUS', 'INDETERMINATE',
    'NO_FEASIBLE_RESULT', 'STALE', 'FAILED', 'CANCELLED'
  )),
  upstream_status TEXT NOT NULL,
  data_snapshot JSONB,
  compute_snapshot JSONB,
  snapshot_adherence JSONB,
  receipt_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS gowm_execution_grounding_idx
  ON wsgs.gowm_execution (data_scope, actor_id, grounding_id, created_at);

CREATE TABLE IF NOT EXISTS wsgs.pipeline_event (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grounding_id TEXT NOT NULL REFERENCES wsgs.grounding_request(grounding_id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES wsgs.grounding_job(job_id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN (
    'LOAD_CONTEXT', 'DETERMINISTIC_PARSE', 'SEMANTIC_MODEL_PARSE',
    'SEMANTIC_FRAME_VALIDATE', 'GROUNDING_GRAPH_BUILD', 'REFERENCE_RESOLVE',
    'REFERENCE_VALIDATE', 'REQUIREMENT_PLAN', 'CAPABILITY_MATCH',
    'WORLD_QUERY_COMPILE', 'GOWM_EXECUTE', 'EVIDENCE_NORMALIZE',
    'PRODUCT_ASSEMBLE', 'RESULT_PERSIST'
  )),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  generation INTEGER NOT NULL CHECK (generation >= 1),
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  stage_execution_id TEXT NOT NULL CHECK (stage_execution_id ~ '^sha256:[0-9a-f]{64}$'),
  run_fingerprint TEXT NOT NULL CHECK (run_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  previous_record_hash TEXT CHECK (previous_record_hash IS NULL OR previous_record_hash ~ '^sha256:[0-9a-f]{64}$'),
  record_hash TEXT NOT NULL CHECK (record_hash ~ '^sha256:[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')),
  input_hash TEXT NOT NULL CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  output_hash TEXT CHECK (output_hash IS NULL OR output_hash ~ '^sha256:[0-9a-f]{64}$'),
  elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms >= 0),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (job_id, generation, sequence),
  UNIQUE (job_id, record_hash)
);

CREATE INDEX IF NOT EXISTS pipeline_event_grounding_idx
  ON wsgs.pipeline_event (grounding_id, generation, event_id);

CREATE TABLE IF NOT EXISTS wsgs.pipeline_checkpoint (
  job_id TEXT PRIMARY KEY REFERENCES wsgs.grounding_job(job_id) ON DELETE CASCADE,
  grounding_id TEXT NOT NULL REFERENCES wsgs.grounding_request(grounding_id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN (
    'GROUND_REFERENCES', 'VALIDATE_REFERENCES',
    'COMPILE_WORLD_QUERY', 'EXECUTE_WORLD_QUERY'
  )),
  run_fingerprint TEXT NOT NULL CHECK (run_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  next_stage_index INTEGER NOT NULL CHECK (next_stage_index BETWEEN 0 AND 14),
  next_event_sequence INTEGER NOT NULL CHECK (next_event_sequence >= 0),
  state_ciphertext BYTEA NOT NULL,
  state_hash TEXT NOT NULL CHECK (state_hash ~ '^sha256:[0-9a-f]{64}$'),
  previous_record_hash TEXT NOT NULL CHECK (previous_record_hash ~ '^sha256:[0-9a-f]{64}$'),
  last_completed_stage TEXT CHECK (last_completed_stage IS NULL OR last_completed_stage IN (
    'LOAD_CONTEXT', 'DETERMINISTIC_PARSE', 'SEMANTIC_MODEL_PARSE',
    'SEMANTIC_FRAME_VALIDATE', 'GROUNDING_GRAPH_BUILD', 'REFERENCE_RESOLVE',
    'REFERENCE_VALIDATE', 'REQUIREMENT_PLAN', 'CAPABILITY_MATCH',
    'WORLD_QUERY_COMPILE', 'GOWM_EXECUTE', 'EVIDENCE_NORMALIZE',
    'PRODUCT_ASSEMBLE', 'RESULT_PERSIST'
  )),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS pipeline_checkpoint_grounding_idx
  ON wsgs.pipeline_checkpoint (grounding_id, run_fingerprint);

CREATE OR REPLACE FUNCTION wsgs.reject_pipeline_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'pipeline events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS pipeline_event_append_only ON wsgs.pipeline_event;
CREATE TRIGGER pipeline_event_append_only
BEFORE UPDATE OR DELETE ON wsgs.pipeline_event
FOR EACH ROW EXECUTE FUNCTION wsgs.reject_pipeline_event_mutation();
