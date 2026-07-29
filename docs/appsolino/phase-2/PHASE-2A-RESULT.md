# Phase 2A Result

**Decision: `PHASE_2A_PARTIAL`**

Date: 2026-07-29  
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
| Ansible syntax/lint | PASS (`ansible-playbook --syntax-check`; `evidence/04-ansible-syntax.txt`) |
| first provisioning run | PASS |
| second idempotent provisioning run | PASS (`changed=0`) |
| filesystem separation | PASS |
| production-path absence | PASS |
| staging PostgreSQL isolation | PASS |
| accepted package build | PASS |
| packaged version identity | PASS (`0.74.0-beta.5`) |
| immutable staging install | PASS |
| staging systemd service | PASS |
| localhost-only listener | PASS |
| health check | PASS |
| migration identity | PASS (`0036`) |
| restart persistence | PASS |
| local backup | PASS |
| restore-test proof | PASS |
| off-host backup | NOT PROVEN (`OFF_HOST_TARGET_NOT_CONFIGURED`) |
| monitoring output | PASS |
| service-path sudo (ACC-ENV-03/04) | PASS |
| service-path host-admin write (ACC-ENV-05) | PASS |
| service-path systemd probe (ACC-ENV-06) | PASS |
| bubblewrap denial (ACC-ENV-07) | PASS |
| explicit host-admin success (ACC-ENV-08) | PASS |
| clean rebuild proof | NOT PROVEN (no disposable Ubuntu target) |
| production untouched | PASS |

## Intentionally deferred (later Phase 2)

1. Approved off-host backup destination + remote-copy verification  
2. Clean rebuild on disposable Ubuntu 24.04 validation target  

## Confirmations

- Phase 3 was **not** started  
- Production remained **DEGRADED / FROZEN** and untouched  
- No production DNS, surgical release, or production DB access  
- No FUSI-007 / contamination / reliability-module re-lands  
- No secrets committed to Git  

## Why PARTIAL (not REJECTED / not full Phase 2)

Local staging foundation works end-to-end. Full Phase 2 completion remains blocked until off-host backup and clean-rebuild proofs pass. This matches the authorised Phase 2A expectation.
