# Privilege and bubblewrap acceptance

## Path classification (Phase 2A correction)

```text
SYSTEMD_SERVICE_CONTEXT: PASS
REAL_FUSION_ENGINE_CHILD_PATH: NOT PROVEN
```

Committed units:

- `fusion-staging-acceptance-run.service` — oneshot harness as `fusion` with approved `NoNewPrivileges=no` / `ProtectSystem=off` (same service model as staging, but **not** an engine-spawned child).
- `fusion-staging-acceptance-probe.service` — harmless `/bin/true` oneshot used only as the ACC-ENV-06 systemd target.

Do **not** describe either unit as `fusion-staging.service → Fusion engine → task/agent child`.

## SYSTEMD_SERVICE_CONTEXT ACC-ENV results

| ID | Expectation | Result |
|----|-------------|--------|
| ACC-ENV-03 | `sudo -n id -u` → `0` | **PASS** |
| ACC-ENV-04 | Harmless package-management probe; non-interactive sudo | **PASS** |
| ACC-ENV-05 | Create/remove under `/etc/appsolino-fusion/staging/acceptance/` | **PASS** |
| ACC-ENV-06 | Harmless dedicated probe unit | **PASS** |
| ACC-ENV-07 | Bubblewrapped ordinary command denied writing acceptance path | **PASS** |
| ACC-ENV-08 | Explicit host-admin outside bubblewrap succeeds; correlation id recorded | **PASS** |

Evidence: `evidence/33-acceptance-result.json` (`path_class=SYSTEMD_SERVICE_CONTEXT`, `fusion_engine_child_path=NOT PROVEN`).

## Bubblewrap (ordinary mode)

Workspace write allowed under staging workspaces; `/etc`, `/opt` releases, and unrelated `/srv` build paths denied. AppArmor userns: `kernel.apparmor_restrict_unprivileged_userns=0` with compensating controls (localhost bind, no public dashboard, allow-listed admin probes).
