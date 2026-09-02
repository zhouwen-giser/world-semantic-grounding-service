ALTER TABLE wsgs.grounding_result
  ADD COLUMN IF NOT EXISTS contract_version TEXT,
  ADD COLUMN IF NOT EXISTS result_profile TEXT,
  ADD COLUMN IF NOT EXISTS contract_selection_hash TEXT,
  ADD COLUMN IF NOT EXISTS geospatial_findings_json JSONB,
  ADD COLUMN IF NOT EXISTS geospatial_profile_schema_hash TEXT,
  ADD COLUMN IF NOT EXISTS geospatial_finding_set_hash TEXT,
  ADD COLUMN IF NOT EXISTS geospatial_source_product_set_hash TEXT,
  ADD COLUMN IF NOT EXISTS geospatial_source_locks JSONB,
  ADD COLUMN IF NOT EXISTS geospatial_source_locks_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'wsgs.grounding_result'::regclass
       AND conname = 'grounding_result_contract_selection_complete'
  ) THEN
    ALTER TABLE wsgs.grounding_result
      ADD CONSTRAINT grounding_result_contract_selection_complete CHECK (
        (contract_version IS NULL AND result_profile IS NULL AND contract_selection_hash IS NULL)
        OR
        (contract_version = 'sacs-wsgs-grounding/1.1' AND
         result_profile = 'sacs-wsgs-geospatial-findings/1.0' AND
         contract_selection_hash ~ '^sha256:[0-9a-f]{64}$')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'wsgs.grounding_result'::regclass
       AND conname = 'grounding_result_geospatial_extension_complete'
  ) THEN
    ALTER TABLE wsgs.grounding_result
      ADD CONSTRAINT grounding_result_geospatial_extension_complete CHECK (
        (geospatial_findings_json IS NULL AND geospatial_profile_schema_hash IS NULL AND
         geospatial_finding_set_hash IS NULL AND geospatial_source_product_set_hash IS NULL AND
         geospatial_source_locks IS NULL AND geospatial_source_locks_hash IS NULL)
        OR
        (result_profile = 'sacs-wsgs-geospatial-findings/1.0' AND
         jsonb_typeof(geospatial_findings_json) = 'object' AND
         geospatial_profile_schema_hash ~ '^sha256:[0-9a-f]{64}$' AND
         geospatial_finding_set_hash ~ '^sha256:[0-9a-f]{64}$' AND
         geospatial_source_product_set_hash ~ '^sha256:[0-9a-f]{64}$' AND
         jsonb_typeof(geospatial_source_locks) = 'array' AND
         geospatial_source_locks_hash ~ '^sha256:[0-9a-f]{64}$')
      );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS wsgs.world_selection (
  selection_id TEXT PRIMARY KEY CHECK (selection_id ~ '^selection-[0-9a-f]{64}$'),
  data_scope TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  authorization_context_hash TEXT NOT NULL CHECK (
    authorization_context_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  prior_grounding_id TEXT NOT NULL REFERENCES wsgs.grounding_result(grounding_id) ON DELETE CASCADE,
  prior_result_hash TEXT NOT NULL CHECK (prior_result_hash ~ '^sha256:[0-9a-f]{64}$'),
  finding_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  selection_revision INTEGER NOT NULL CHECK (selection_revision >= 1),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^sha256:[0-9a-f]{64}$'),
  reference_key JSONB,
  token_key_id TEXT,
  token_hash TEXT CHECK (token_hash IS NULL OR token_hash ~ '^sha256:[0-9a-f]{64}$'),
  selection_result_hash TEXT NOT NULL CHECK (selection_result_hash ~ '^sha256:[0-9a-f]{64}$'),
  selected_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT world_selection_upstream_identity_exactly_one CHECK (
    (reference_key IS NOT NULL AND token_key_id IS NULL AND token_hash IS NULL)
    OR
    (reference_key IS NULL AND token_key_id IS NOT NULL AND token_hash IS NOT NULL)
  ),
  CONSTRAINT world_selection_expiry_order CHECK (expires_at > selected_at),
  UNIQUE (
    data_scope, actor_id, principal_id, authorization_context_hash,
    prior_grounding_id, finding_id, feature_id, selection_revision
  )
);

CREATE INDEX IF NOT EXISTS world_selection_binding_idx
  ON wsgs.world_selection (
    data_scope, actor_id, principal_id, authorization_context_hash,
    prior_grounding_id, finding_id, feature_id, selection_revision DESC
  );

CREATE TABLE IF NOT EXISTS wsgs.source_currentness_validation (
  grounding_id TEXT PRIMARY KEY REFERENCES wsgs.grounding_result(grounding_id) ON DELETE CASCADE,
  data_scope TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  authorization_context_hash TEXT NOT NULL CHECK (
    authorization_context_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  contract_selection_hash TEXT NOT NULL CHECK (contract_selection_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_json JSONB NOT NULL CHECK (jsonb_typeof(request_json) = 'object'),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_json JSONB NOT NULL CHECK (jsonb_typeof(result_json) = 'object'),
  validation_result_hash TEXT NOT NULL CHECK (validation_result_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_product_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  previous_content_hash TEXT NOT NULL CHECK (previous_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  current_content_hash TEXT CHECK (
    current_content_hash IS NULL OR current_content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  currentness TEXT NOT NULL CHECK (currentness IN ('CURRENT', 'CHANGED', 'NOT_AVAILABLE', 'UNKNOWN')),
  checked_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_currentness_hash_presence CHECK (
    (currentness IN ('CURRENT', 'CHANGED') AND current_content_hash IS NOT NULL)
    OR
    (currentness IN ('NOT_AVAILABLE', 'UNKNOWN') AND current_content_hash IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS source_currentness_authority_idx
  ON wsgs.source_currentness_validation (
    data_scope, actor_id, principal_id, authorization_context_hash, product_id, checked_at DESC
  );
