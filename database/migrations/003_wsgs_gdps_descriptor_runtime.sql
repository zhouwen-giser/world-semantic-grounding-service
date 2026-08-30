ALTER TABLE wsgs.capability_snapshot
  ADD COLUMN IF NOT EXISTS gdps_consumer_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS gdps_provider_version TEXT,
  ADD COLUMN IF NOT EXISTS gdps_consumer_lock_hash TEXT,
  ADD COLUMN IF NOT EXISTS gdps_capability_lock_hash TEXT,
  ADD COLUMN IF NOT EXISTS gdps_descriptor_lock_hash TEXT,
  ADD COLUMN IF NOT EXISTS gdps_recipe_lock_hash TEXT,
  ADD COLUMN IF NOT EXISTS gdps_capability_keys JSONB,
  ADD COLUMN IF NOT EXISTS gdps_capability_snapshot_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'wsgs.capability_snapshot'::regclass
       AND conname = 'capability_snapshot_gdps_extension_complete'
  ) THEN
    ALTER TABLE wsgs.capability_snapshot
      ADD CONSTRAINT capability_snapshot_gdps_extension_complete CHECK (
        (gdps_consumer_snapshot IS NULL AND gdps_provider_version IS NULL AND
         gdps_consumer_lock_hash IS NULL AND gdps_capability_lock_hash IS NULL AND
         gdps_descriptor_lock_hash IS NULL AND gdps_recipe_lock_hash IS NULL AND
         gdps_capability_keys IS NULL AND gdps_capability_snapshot_hash IS NULL)
        OR
        (gdps_consumer_snapshot IS NOT NULL AND gdps_provider_version IS NOT NULL AND
         gdps_consumer_lock_hash ~ '^sha256:[0-9a-f]{64}$' AND
         gdps_capability_lock_hash ~ '^sha256:[0-9a-f]{64}$' AND
         gdps_descriptor_lock_hash ~ '^sha256:[0-9a-f]{64}$' AND
         gdps_recipe_lock_hash ~ '^sha256:[0-9a-f]{64}$' AND
         jsonb_typeof(gdps_capability_keys) = 'array' AND
         jsonb_array_length(gdps_capability_keys) = 30 AND
         gdps_capability_snapshot_hash ~ '^sha256:[0-9a-f]{64}$')
      );
  END IF;
END;
$$;
