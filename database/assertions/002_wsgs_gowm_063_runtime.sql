DO $$
DECLARE
  missing_tables TEXT[];
  missing_columns TEXT[];
BEGIN
  SELECT array_agg(required.name ORDER BY required.name)
    INTO missing_tables
  FROM (VALUES ('gowm_execution'), ('pipeline_checkpoint'), ('pipeline_event')) AS required(name)
  WHERE to_regclass('wsgs.' || required.name) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'missing WSGS 0.2 tables: %', missing_tables;
  END IF;

  SELECT array_agg(required.table_name || '.' || required.column_name ORDER BY required.table_name, required.column_name)
    INTO missing_columns
  FROM (VALUES
    ('grounding_request', 'actor_id'),
    ('grounding_request', 'dataset_scopes'),
    ('grounding_request', 'authorization_context_hash'),
    ('grounding_request', 'gowm_contract_catalog_revision'),
    ('grounding_request', 'gowm_semantic_catalog_hash'),
    ('grounding_request', 'gowm_consumer_package_integrity'),
    ('grounding_request', 'gowm_operation_lock_hash'),
    ('grounding_job', 'pipeline_stage'),
    ('grounding_job', 'stage_generation'),
    ('grounding_job', 'started_at'),
    ('grounding_job', 'max_result_bytes'),
    ('grounding_job', 'immutable_locks'),
    ('capability_snapshot', 'contract_catalog_revision'),
    ('capability_snapshot', 'semantic_catalog_hash'),
    ('capability_snapshot', 'availability_snapshot'),
    ('world_query', 'gateway_query_id'),
    ('world_query', 'query_snapshot_manifest'),
    ('world_query', 'snapshot_adherence'),
    ('pipeline_event', 'sequence'),
    ('pipeline_event', 'stage_execution_id'),
    ('pipeline_event', 'run_fingerprint'),
    ('pipeline_event', 'previous_record_hash'),
    ('pipeline_event', 'record_hash'),
    ('pipeline_checkpoint', 'operation'),
    ('pipeline_checkpoint', 'run_fingerprint'),
    ('pipeline_checkpoint', 'next_stage_index'),
    ('pipeline_checkpoint', 'state_ciphertext'),
    ('pipeline_checkpoint', 'state_hash'),
    ('pipeline_checkpoint', 'next_event_sequence'),
    ('pipeline_checkpoint', 'previous_record_hash'),
    ('pipeline_checkpoint', 'last_completed_stage')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
      FROM information_schema.columns AS actual
     WHERE actual.table_schema = 'wsgs'
       AND actual.table_name = required.table_name
       AND actual.column_name = required.column_name
  );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'missing WSGS 0.2 columns: %', missing_columns;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'wsgs' AND indexname = 'grounding_job_scope_actor_idx'
  ) THEN
    RAISE EXCEPTION 'missing grounding_job_scope_actor_idx';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'wsgs' AND indexname = 'pipeline_event_grounding_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'wsgs' AND indexname = 'pipeline_checkpoint_grounding_idx'
  ) THEN
    RAISE EXCEPTION 'missing W04 pipeline persistence index';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger AS trigger
      JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'wsgs'
       AND relation.relname = 'pipeline_event'
       AND trigger.tgname = 'pipeline_event_append_only'
       AND NOT trigger.tgisinternal
  ) THEN
    RAISE EXCEPTION 'missing append-only pipeline event trigger';
  END IF;
END;
$$;
