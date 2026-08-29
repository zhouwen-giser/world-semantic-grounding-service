DO $$
DECLARE
  missing_columns TEXT[];
BEGIN
  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO missing_columns
    FROM (VALUES
      ('gdps_consumer_snapshot'),
      ('gdps_provider_version'),
      ('gdps_consumer_lock_hash'),
      ('gdps_capability_lock_hash'),
      ('gdps_descriptor_lock_hash'),
      ('gdps_recipe_lock_hash'),
      ('gdps_capability_keys'),
      ('gdps_capability_snapshot_hash')
    ) AS required(column_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns AS actual
      WHERE actual.table_schema = 'wsgs'
        AND actual.table_name = 'capability_snapshot'
        AND actual.column_name = required.column_name
   );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'missing WSGS GDPS snapshot columns: %', missing_columns;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'wsgs.capability_snapshot'::regclass
       AND conname = 'capability_snapshot_gdps_extension_complete'
  ) THEN
    RAISE EXCEPTION 'missing capability_snapshot_gdps_extension_complete';
  END IF;
END;
$$;
