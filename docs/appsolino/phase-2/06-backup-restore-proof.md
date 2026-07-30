# Backup and restore proof

## Local backup (final committed script)

- Tool: `/usr/local/sbin/staging-backup.sh`
- Variables: `dump_path` (under `/srv/appsolino-fusion/staging/backups/`) and `source_main_sha` are distinct — Git/RELEASE_IDENTITY resolution must never overwrite the dump pathname.
- Method: `pg_dump --format=custom` as `postgres` (FORCE RLS safe)
- Metadata JSON references the exact `dump_path`
- Source SHA preferred from `RELEASE_IDENTITY`

Post-correction proof dump:

- File: `/srv/appsolino-fusion/staging/backups/fusion_staging_20260730T043949Z.dump`
- Backup SHA-256: `489c6b5f6af5d542c6754ee419f39d0e2ee4534c489544729e836d11c9da461e`
- `source_main_sha`: `040b61e8873e77eeae04816a2dce9cccdde7f88c`
- Highest migration: `0036`
- Result: **PASS** (`evidence/36-backup.log`)

## Restore test

- Restored into `fusion_staging_restore_test`
- Marker count 2 / migration `0036` match
- Restore DB destroyed afterward (`evidence/37-dbs-after.txt` shows no restore-test DB)
- Result: **PASS**

## Off-host backup

- **NOT PROVEN** — `OFF_HOST_TARGET_NOT_CONFIGURED`
