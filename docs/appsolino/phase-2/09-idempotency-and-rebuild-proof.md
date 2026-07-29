# Idempotency and rebuild proof

## Ansible on Host D

| Run | Result |
|-----|--------|
| First `provision-staging.yml` | **PASS** (`changed` > 0; see `evidence/02-provision-first-run.log`) |
| Second run | **PASS** with `changed=0` (`evidence/03-provision-second-run.log`) |

Playbooks are modular/idempotent under `infra/ansible/`.

## Clean rebuild from Ubuntu 24.04

No disposable validation target (VM / container / snapshot / approved disposable VPS) was available for this mission.

| Item | Status |
|------|--------|
| Idempotency on configured Host D | **PASS** |
| Clean rebuild from bare Ubuntu 24.04 | **NOT PROVEN** |

Do **not** claim full Phase 2 completion until clean-rebuild proof exists on an approved disposable target. Cloud-init bootstrap (`infra/cloud-init/staging-bootstrap.yaml`) is committed for that later proof.
