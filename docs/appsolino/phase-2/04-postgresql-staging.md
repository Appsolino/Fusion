# PostgreSQL staging identity

## Isolated identities (Host D)

| Item | Value |
|------|--------|
| Role | `fusion_staging` |
| Database | `fusion_staging` |
| Restore-test DB | `fusion_staging_restore_test` (created only during restore proof; destroyed after) |
| Listen | localhost only (`127.0.0.1`) |
| Auth | SCRAM-SHA-256; password in `/etc/appsolino-fusion/staging/secrets.env` (root:fusion 0640; untracked) |
| Version | PostgreSQL 16.14 |
| Encoding / locale | UTF8 / `en_US.UTF-8` (host default) |
| Owner | `fusion_staging` |
| Highest applied migration | `0036` via `public.fusion_schema_migrations` (service first-boot; not hand-stamped) |
| Production names | none created |

Phase 1 evidence DBs (`fusion_phase1_*`) remain on Host D for prior mission evidence and are not used by staging.

## Evidence

- `evidence/20-pg-*.txt`, `evidence/20-mig-high.txt`, `evidence/04-postgresql-*.txt` (if present)
