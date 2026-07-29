# Privilege and bubblewrap acceptance

Harness starts from systemd service context (`fusion-staging-acceptance-probe.service` / `run-staging-acceptance.sh`), not an interactive `fusion` shell alone.

## ACC-ENV results

| ID | Expectation | Result |
|----|-------------|--------|
| ACC-ENV-03 | `sudo -n id -u` → `0` from Fusion-spawned child | **PASS** |
| ACC-ENV-04 | Harmless package-management probe; non-interactive sudo | **PASS** |
| ACC-ENV-05 | Create/remove under `/etc/appsolino-fusion/staging/acceptance/` | **PASS** |
| ACC-ENV-06 | Harmless dedicated test unit systemd op (not SSH/PG/Fusion) | **PASS** |
| ACC-ENV-07 | Bubblewrapped ordinary command denied writing acceptance path | **PASS** |
| ACC-ENV-08 | Explicit host-admin outside bubblewrap succeeds; correlation id recorded | **PASS** |

Correlation id example: `phase2a-acc-20260729T190754Z-54217` (`evidence/17-acceptance-result.json`).

## Bubblewrap

- Ordinary mode: workspace write allowed under staging workspaces; `/etc`, `/opt` releases, `/srv/.../build` denied
- AppArmor userns: `kernel.apparmor_restrict_unprivileged_userns=0` (recorded; compensating controls: UFW localhost bind, no public dashboard, allow-listed host-admin probes only)
- Result: **BUBBLEWRAP_PASS** (`evidence/18-bubblewrap.log`)

## Security note

Host-admin mode must be explicit and auditable; ordinary task commands remain bubblewrapped. Acceptance suite is fixed allow-list — not arbitrary root execution of unreviewed input.
