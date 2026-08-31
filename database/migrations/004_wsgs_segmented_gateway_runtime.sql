ALTER TABLE wsgs.world_query
  ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'SINGLE_GATEWAY_QUERY',
  ADD COLUMN IF NOT EXISTS segment_manifest_hash TEXT;

ALTER TABLE wsgs.world_query
  DROP CONSTRAINT IF EXISTS world_query_execution_mode_check;
ALTER TABLE wsgs.world_query
  ADD CONSTRAINT world_query_execution_mode_check CHECK (
    execution_mode IN ('SINGLE_GATEWAY_QUERY', 'SEGMENTED_GATEWAY_QUERIES')
  );
ALTER TABLE wsgs.world_query
  DROP CONSTRAINT IF EXISTS world_query_segment_manifest_hash_check;
ALTER TABLE wsgs.world_query
  ADD CONSTRAINT world_query_segment_manifest_hash_check CHECK (
    (execution_mode = 'SINGLE_GATEWAY_QUERY' AND segment_manifest_hash IS NULL)
    OR
    (execution_mode = 'SEGMENTED_GATEWAY_QUERIES' AND
     segment_manifest_hash ~ '^sha256:[0-9a-f]{64}$')
  );

ALTER TABLE IF EXISTS wsgs.world_query_segment
  DROP CONSTRAINT IF EXISTS world_query_segment_parent_fk;
ALTER TABLE wsgs.world_query
  DROP CONSTRAINT IF EXISTS world_query_query_grounding_unique;
ALTER TABLE wsgs.world_query
  ADD CONSTRAINT world_query_query_grounding_unique UNIQUE (query_id, grounding_id);

CREATE TABLE IF NOT EXISTS wsgs.world_query_segment (
  segment_id TEXT PRIMARY KEY CHECK (segment_id ~ '^segment-[0-9a-f]{32}$'),
  query_id TEXT NOT NULL REFERENCES wsgs.world_query(query_id) ON DELETE CASCADE,
  grounding_id TEXT NOT NULL REFERENCES wsgs.grounding_request(grounding_id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL CHECK (segment_index >= 0 AND segment_index < 64),
  node_id TEXT NOT NULL CHECK (node_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'),
  operation_key TEXT NOT NULL CHECK (operation_key ~ '^[a-z][a-z0-9.-]{2,127}@[0-9]+\.[0-9]+$'),
  data_scope TEXT NOT NULL CHECK (
    data_scope ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$' AND position('*' IN data_scope) = 0
  ),
  source_lock_hash TEXT NOT NULL CHECK (source_lock_hash ~ '^sha256:[0-9a-f]{64}$'),
  scope_authority_hash TEXT NOT NULL CHECK (scope_authority_hash ~ '^sha256:[0-9a-f]{64}$'),
  plan JSONB NOT NULL,
  plan_hash TEXT NOT NULL CHECK (plan_hash ~ '^sha256:[0-9a-f]{64}$'),
  delegated_identity_hash TEXT NOT NULL CHECK (delegated_identity_hash ~ '^sha256:[0-9a-f]{64}$'),
  completion_delegated_identity_hash TEXT CHECK (
    completion_delegated_identity_hash IS NULL OR
    completion_delegated_identity_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  gateway_query_id TEXT,
  gateway_job_id TEXT,
  upstream_status TEXT,
  upstream_result_hash TEXT CHECK (
    upstream_result_hash IS NULL OR upstream_result_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  world_result_hash TEXT,
  response_status INTEGER CHECK (response_status IS NULL OR response_status IN (200, 202)),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (query_id, segment_index),
  UNIQUE (query_id, node_id),
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  CHECK ((finished_at IS NULL) = (upstream_result_hash IS NULL)),
  CHECK ((finished_at IS NULL) = (completion_delegated_identity_hash IS NULL)),
  CONSTRAINT world_query_segment_world_result_hash_check CHECK (
    world_result_hash IS NULL OR world_result_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT world_query_segment_completion_hashes_check CHECK (
    (finished_at IS NULL) = (world_result_hash IS NULL)
  )
);

ALTER TABLE wsgs.world_query_segment
  ADD COLUMN IF NOT EXISTS world_result_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'wsgs.world_query_segment'::regclass
       AND conname = 'world_query_segment_world_result_hash_check'
  ) THEN
    ALTER TABLE wsgs.world_query_segment
      ADD CONSTRAINT world_query_segment_world_result_hash_check CHECK (
        world_result_hash IS NULL OR world_result_hash ~ '^sha256:[0-9a-f]{64}$'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'wsgs.world_query_segment'::regclass
       AND conname = 'world_query_segment_completion_hashes_check'
  ) THEN
    ALTER TABLE wsgs.world_query_segment
      ADD CONSTRAINT world_query_segment_completion_hashes_check CHECK (
        (finished_at IS NULL) = (world_result_hash IS NULL)
      );
  END IF;
END;
$$;

ALTER TABLE wsgs.world_query_segment
  ADD CONSTRAINT world_query_segment_parent_fk
    FOREIGN KEY (query_id, grounding_id)
    REFERENCES wsgs.world_query(query_id, grounding_id)
    ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS world_query_segment_grounding_idx
  ON wsgs.world_query_segment (data_scope, grounding_id, query_id, segment_index);
