# Backup and restore proof

## Local backup

- Tool: `/usr/local/sbin/staging-backup.sh`
- Method: `pg_dump --format=custom` as `postgres` superuser (required because FORCE RLS blocks owner dumps of some tables)
- Output: `/srv/appsolino-fusion/staging/backups/fusion_staging_<UTC>.dump` mode `0600`
- Metadata JSON under `.../backups/meta/` including PostgreSQL version, release id, executable SHA-256, migration-set SHA-256, backup SHA-256
- Marker tasks created through Fusion CLI in staging project: descriptions containing `Phase2A backup marker` (`KB-001`, `KB-002`)

Example local proof dump:

- File: `fusion_staging_20260729T191356Z.dump`
- Backup SHA-256: `e9d5148e792b3fc86df0ec4fd9c257773fd21260fbab72f331e52ececafe86a0`
- Highest migration: `0036`
- Result: **PASS**

## Restore test

- Tool: `/usr/local/sbin/staging-restore-test.sh`
- Restored into `fusion_staging_restore_test`, verified migration identity `0036` and marker count match (2), then destroyed restore DB
- Result: **PASS** (`evidence/16-restore-result.json`)

## Off-host backup

- Provider-neutral interface + `off-host-backup.env.example` installed
- No approved external target configured
- Script reports: **`OFF_HOST_TARGET_NOT_CONFIGURED`**
- Status: **NOT PROVEN** (Phase 2 completion blocker; acceptable for Phase 2A PARTIAL)

## Evidence

`evidence/15-backup.log`, `evidence/16-restore-test.log`, `evidence/16-restore-result.json`
