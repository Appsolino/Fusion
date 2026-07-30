# PostgreSQL staging identity

## Isolated identities (Host D)

| Item | Value |
|------|--------|
| Role | `fusion_staging` |
| Database | `fusion_staging` |
| Listen | localhost only |
| Auth | SCRAM-SHA-256 enforced |
| Version | PostgreSQL 16.14 |
| Highest migration | `0036` |

## SCRAM enforcement (corrected)

Provisioning now:

- sets `password_encryption=scram-sha-256`
- ensures `pg_hba.conf` localhost TCP host rules use `scram-sha-256`
- retains `local … peer` for postgres administration
- verifies `fusion_staging` role verifier prefix `SCRAM-SHA-256` without exposing the secret

Evidence: `evidence/39-postgres-scram-proof.txt`.
