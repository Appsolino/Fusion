# Idempotency and rebuild proof

## Ansible on Host D (post-correction)

Authoritative variables: `infra/ansible/inventory/group_vars/` only (duplicate `group_vars/` trees removed).

| Run | Result |
|-----|--------|
| Syntax check | **PASS** |
| First provision after corrections | **PASS** (`changed=6`) |
| Second run | **PASS** (`changed=0`) |

## Clean rebuild from Ubuntu 24.04

**NOT PROVEN** — no disposable validation target in this mission.
