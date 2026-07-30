# Phase 2A Result (PR #10 correction)

**Decision: `PHASE_2A_PARTIAL`**

**Merge:** PR #10 merged 2026-07-30 as `6caca1ec66e8428493982e29241e47df0857be00` (corrected head `409fafcff8ee02a2f7137adc192319c69e9cd6e7`). Staging foundation is **usable**. Remaining NOT PROVEN items are pre-production / pre-autonomous-admin gates per `docs/appsolino/OPERATING-MODEL.md` — they do not block ordinary staging or daily development.

Date: 2026-07-30 (correction requalification + merge)  
Starting `origin/main`: `040b61e8873e77eeae04816a2dce9cccdde7f88c`  
Branch: `phase-2a/staging-infrastructure-foundation`  
Host: Host D `vmi3201923` / `37.60.253.164`  
Accepted package: `0.74.0-beta.5`  
Release: `phase2a-0.74.0-beta.5-040b61e8873e`  
Executable SHA-256: `54e2cd933281ca523e57303c578c4e14b60cd5914006fac8c9145703a39a0c48`  
Staging DB: `fusion_staging` / role `fusion_staging` / migrations through **0036**

## Gate table

| Item | Classification |
|------|----------------|
| clean main-based branch | PASS |
| Ansible syntax/lint | PASS (`evidence/30-ansible-syntax.txt`) |
| authoritative group_vars (single inventory hierarchy) | PASS |
| first provisioning run (post-correction) | PASS (`changed=6`) |
| second idempotent provisioning run | PASS (`changed=0`) |
| filesystem separation | PASS |
| production-path absence | PASS |
| staging PostgreSQL isolation | PASS |
| PostgreSQL SCRAM enforcement + proof | PASS (`evidence/39-postgres-scram-proof.txt`) |
| accepted package build | PASS |
| packaged version identity | PASS (`0.74.0-beta.5`) |
| immutable staging install (no overwrite; noop/conflict) | PASS |
| mandatory secrets.env + prestart validation | PASS |
| staging systemd service | PASS |
| localhost-only listener | PASS |
| health check (non-zero on failure) | PASS |
| health negative proofs | PASS (`evidence/35-health-negative-results.json`) |
| migration identity (`fusion_schema_migrations` = 0036) | PASS |
| restart persistence | PASS |
| local backup (final script; dump path + source SHA distinct) | PASS |
| restore-test proof | PASS |
| off-host backup | NOT PROVEN (`OFF_HOST_TARGET_NOT_CONFIGURED`) |
| monitoring output | PASS |
| SYSTEMD_SERVICE_CONTEXT ACC-ENV-03..08 | PASS |
| REAL_FUSION_ENGINE_CHILD_PATH | NOT PROVEN |
| clean rebuild proof | NOT PROVEN (no disposable Ubuntu target) |
| production untouched | PASS |

## ACC-ENV classification (corrected)

```text
SYSTEMD_SERVICE_CONTEXT: PASS
  unit: fusion-staging-acceptance-run.service (committed)
  ACC-ENV-03..08: PASS
  probe target for ACC-ENV-06: fusion-staging-acceptance-probe.service (committed oneshot /bin/true)

REAL_FUSION_ENGINE_CHILD_PATH: NOT PROVEN
  Required path fusion-staging.service → Fusion engine → task/agent child
  was not traversed in Phase 2A. Do not label ACC results as Fusion-spawned child PASS.
```

## Intentionally deferred (later Phase 2)

1. Approved off-host backup destination + remote-copy verification  
2. Clean rebuild on disposable Ubuntu 24.04 validation target  
3. Real Fusion engine → child privilege/bubblewrap path

## Confirmations

- Phase 3 was **not** started  
- Phase 2B was **not** started  
- Production remained **DEGRADED / FROZEN** and untouched  
- PR #10 corrections pushed; **not merged**  
- No secrets committed to Git  

## Why PARTIAL

Local staging foundation works after review corrections. Full Phase 2 completion remains blocked until off-host backup, clean-rebuild, and real Fusion engine-child path proofs pass.
