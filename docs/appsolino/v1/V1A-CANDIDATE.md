# V1A production candidate (Host D)

Last updated: 2026-07-30

result: PASS
status: COMPLETE (PR #11 merged `45ab251001b75c701de501f1d96b8d6a34f5bd7b`)
V1B: READY / NOT STARTED

## Identity

- release ID: `v1a-0.74.0-beta.5-f54d53082`
- source commit: `f54d53082f08a4d8236dc21980c9ae4ec3d13671`
- version: `0.74.0-beta.5`
- Node: `v22.23.1`
- pnpm: `10.33.0`
- executable SHA-256: `5f33e09a2a004318b015e341dd37c88b841c3eea572e53f89658d51529b7ce4a`
- archive SHA-256: `9a3c275a34e39004d0c026e3b2a864b6f4064d174618d7f4383c3b62c7ae6598`
- migration-set SHA-256: `846da68e7c82f3acd9e8cfd847b4fd49a4e14251571e8063f0ed66e90282a570`
- build timestamp (UTC): `2026-07-30T06:12:27+00:00`
- Host D artefact path: `/srv/appsolino-fusion/build/v1a/v1a-0.74.0-beta.5-f54d53082`
- staging release path: `/opt/appsolino-fusion/staging/releases/v1a-0.74.0-beta.5-f54d53082`
- previous staging release: `phase2a-0.74.0-beta.5-040b61e8873e` (preserved)

## Focused validation

| Check | Result |
| --- | --- |
| A Identity (version, installed hash, release ID) | PASS |
| B Service (active, localhost:4140, health 0.74.0-beta.5, no startup-fatal) | PASS |
| C Database (`fusion_staging`, migration 0036, no production DB identity) | PASS |
| D Functional smoke (create/read/update KB-003 + restart persistence) | PASS |
| E Backup/restore (local dump + restore-test DB + destroy) | PASS |
| F Isolation (previous release kept; Host D production absent) | PASS |

Notes:

- Host literal hostname is `vmi3201923` (established Host D); not the string `dev-fusion`.
- First `build:exe` failed (`bun` missing from PATH); one corrective tooling retry with Phase 2A `.bun/bin` succeeded. No product changes.
- Post-restart task read required a short readiness wait (transient 503); KB-003 then readable with priority `low`.

## Explicit statements

- HOST_D_PRODUCTION_IDENTITIES: ABSENT
- HOST_P_ACCESSED: NO
- LEGACY_PRODUCTION_TOUCHED: NO
- V1B_STARTED: NO
- V1B: READY / NOT STARTED (requires Host P SSH target before mission)
