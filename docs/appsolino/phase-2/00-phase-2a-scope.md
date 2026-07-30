# Phase 2A Scope

Date: 2026-07-29
Starting `origin/main`: `040b61e8873e77eeae04816a2dce9cccdde7f88c`
Branch: `phase-2a/staging-infrastructure-foundation`
Host D: `vmi3201923` / `37.60.253.164` (development/build/staging-lite only)

## In scope

- Reproducible Ansible provisioning (+ minimal cloud-init bootstrap)
- Formal build / staging / production path separation (production reserved in docs only)
- Staging-only Fusion systemd service on localhost
- Isolated staging PostgreSQL (`fusion_staging`)
- Local backup + restore-test proof
- Monitoring textfile skeleton
- Real service-context ACC-ENV-03..08 and bubblewrap denial proofs

## Out of scope / prohibited

- Production deploy/migration/DNS/surgical release changes
- FUSI-007 / contamination / merge-reliability re-lands
- Scheduler/executor/workflow product changes
- Phase 3 release activator / production controller
- Off-host backup account purchase/configuration (interface only; expected NOT PROVEN)

## Expected decision

`PHASE_2A_PARTIAL` until an approved off-host backup target and disposable clean-rebuild host are available.
