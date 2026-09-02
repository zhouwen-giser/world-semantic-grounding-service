DO $$
DECLARE
  missing_columns TEXT[];
BEGIN
  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO missing_columns
    FROM (VALUES
      ('contract_version'), ('result_profile'), ('contract_selection_hash'),
      ('geospatial_findings_json'), ('geospatial_profile_schema_hash'),
      ('geospatial_finding_set_hash'), ('geospatial_source_product_set_hash'),
      ('geospatial_source_locks'), ('geospatial_source_locks_hash')
    ) AS required(column_name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns AS actual
      WHERE actual.table_schema = 'wsgs'
        AND actual.table_name = 'grounding_result'
        AND actual.column_name = required.column_name
   );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'missing SACS geospatial grounding_result columns: %', missing_columns;
  END IF;

  IF to_regclass('wsgs.world_selection') IS NULL THEN
    RAISE EXCEPTION 'missing wsgs.world_selection';
  END IF;
  IF to_regclass('wsgs.source_currentness_validation') IS NULL THEN
    RAISE EXCEPTION 'missing wsgs.source_currentness_validation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'wsgs.grounding_result'::regclass
       AND conname = 'grounding_result_contract_selection_complete' AND contype = 'c'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'wsgs.grounding_result'::regclass
       AND conname = 'grounding_result_geospatial_extension_complete' AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'missing grounding_result SACS geospatial completeness constraints';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'wsgs.world_selection'::regclass
       AND conname = 'world_selection_upstream_identity_exactly_one' AND contype = 'c'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'wsgs.world_selection'::regclass
       AND conname = 'world_selection_expiry_order' AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'missing world_selection safety constraints';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'wsgs.source_currentness_validation'::regclass
       AND conname = 'source_currentness_hash_presence' AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'missing source_currentness hash presence constraint';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'wsgs.world_selection'::regclass
       AND contype = 'f' AND confrelid = 'wsgs.grounding_result'::regclass
       AND confdeltype = 'c'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'wsgs.source_currentness_validation'::regclass
       AND contype = 'f' AND confrelid = 'wsgs.grounding_result'::regclass
       AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'missing SACS geospatial result lineage foreign keys';
  END IF;
END;
$$;
