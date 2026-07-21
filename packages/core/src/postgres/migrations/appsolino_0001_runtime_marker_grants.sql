/*
Appsolino runtime bookkeeping authorization.

The project runtime uses the restricted fusion_runtime role, while the
legacy-adoption optimization stores its completion marker in the public
fusion_schema_migrations table.

Permit the exact marker operation without allowing the runtime role to forge
numeric or unrelated migration records.
*/

CREATE OR REPLACE FUNCTION public.fusion_guard_runtime_migration_marker_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'fusion_runtime'
     AND NEW.version <> 'legacy-adoption-drained' THEN
    RAISE EXCEPTION
      'fusion_runtime may insert only the legacy-adoption-drained marker'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fusion_guard_runtime_migration_marker_insert
  ON public.fusion_schema_migrations;

CREATE TRIGGER fusion_guard_runtime_migration_marker_insert
BEFORE INSERT ON public.fusion_schema_migrations
FOR EACH ROW
EXECUTE FUNCTION public.fusion_guard_runtime_migration_marker_insert();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'fusion_runtime'
  ) THEN
    GRANT USAGE ON SCHEMA public TO fusion_runtime;

    GRANT SELECT, INSERT
      ON TABLE public.fusion_schema_migrations
      TO fusion_runtime;
  END IF;
END;
$$;
