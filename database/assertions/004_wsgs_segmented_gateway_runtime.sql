DO $$
DECLARE
  missing_columns TEXT[];
BEGIN
  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO missing_columns
    FROM (VALUES
      ('execution_mode'),
      ('segment_manifest_hash')
    ) AS required(column_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns AS actual
      WHERE actual.table_schema = 'wsgs'
        AND actual.table_name = 'world_query'
        AND actual.column_name = required.column_name
   );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'missing segmented world_query columns: %', missing_columns;
  END IF;

  IF to_regclass('wsgs.world_query_segment') IS NULL THEN
    RAISE EXCEPTION 'missing wsgs.world_query_segment';
  END IF;

  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO missing_columns
    FROM (VALUES
      ('segment_id'), ('query_id'), ('grounding_id'), ('segment_index'), ('node_id'),
      ('operation_key'), ('data_scope'), ('source_lock_hash'), ('scope_authority_hash'),
      ('plan'), ('plan_hash'), ('delegated_identity_hash'), ('completion_delegated_identity_hash'),
      ('gateway_query_id'),
      ('gateway_job_id'), ('upstream_status'), ('upstream_result_hash'),
      ('world_result_hash'),
      ('response_status'), ('started_at'), ('finished_at')
    ) AS required(column_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns AS actual
      WHERE actual.table_schema = 'wsgs'
        AND actual.table_name = 'world_query_segment'
        AND actual.column_name = required.column_name
   );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'missing world_query_segment columns: %', missing_columns;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'wsgs.world_query'::regclass
       AND conname = 'world_query_execution_mode_check'
  ) THEN
    RAISE EXCEPTION 'missing world_query_execution_mode_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'wsgs.world_query'::regclass
       AND conname = 'world_query_segment_manifest_hash_check'
  ) THEN
    RAISE EXCEPTION 'missing world_query_segment_manifest_hash_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'wsgs.world_query_segment'::regclass
       AND conname = 'world_query_segment_world_result_hash_check'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'missing world_query_segment_world_result_hash_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'wsgs.world_query_segment'::regclass
       AND conname = 'world_query_segment_completion_hashes_check'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'missing world_query_segment_completion_hashes_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'wsgs.world_query_segment'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (query_id, segment_index)'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'wsgs.world_query_segment'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (query_id, node_id)'
  ) THEN
    RAISE EXCEPTION 'missing world_query_segment uniqueness fences';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'wsgs.world_query'::regclass
       AND conname = 'world_query_query_grounding_unique'
       AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (query_id, grounding_id)'
  ) THEN
    RAISE EXCEPTION 'missing world_query query-grounding parent key';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'wsgs.world_query_segment'::regclass
       AND conname = 'world_query_segment_parent_fk'
       AND contype = 'f'
       AND confrelid = 'wsgs.world_query'::regclass
       AND confdeltype = 'c'
       AND conkey = ARRAY[
         (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'wsgs.world_query_segment'::regclass AND attname = 'query_id'),
         (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'wsgs.world_query_segment'::regclass AND attname = 'grounding_id')
       ]::SMALLINT[]
       AND confkey = ARRAY[
         (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'wsgs.world_query'::regclass AND attname = 'query_id'),
         (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'wsgs.world_query'::regclass AND attname = 'grounding_id')
       ]::SMALLINT[]
  ) THEN
    RAISE EXCEPTION 'missing world_query_segment composite parent fence';
  END IF;
END;
$$;
