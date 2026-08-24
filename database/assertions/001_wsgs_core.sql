DO $$
DECLARE
  missing_tables TEXT[];
BEGIN
  SELECT array_agg(required.name ORDER BY required.name)
    INTO missing_tables
  FROM (VALUES
    ('grounding_request'), ('grounding_job'), ('idempotency'), ('semantic_frame'),
    ('grounding_graph'), ('world_query'), ('grounding_result'), ('result_product'),
    ('capability_snapshot'), ('model_receipt')
  ) AS required(name)
  WHERE to_regclass('wsgs.' || required.name) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'missing WSGS tables: %', missing_tables;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'wsgs' AND indexname = 'grounding_job_claim_idx'
  ) THEN
    RAISE EXCEPTION 'missing grounding_job_claim_idx';
  END IF;
END;
$$;

