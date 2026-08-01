# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-01T02:00:48Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `79034f508` (AUTO-3 + receive stdin hotfix) |
| Active Host D release | `auto3-0.74.0-beta.5-a1b78a197860` |
| Executable SHA-256 | `d96d3da599598a02239c9e0ae499f4b6571a9d372f6add3a32d9e7aabdc27497` |
| Archive SHA-256 | `8719344cea79fbe90d6d29361fa47f33460095443aea058f01fb166d797b8773` |
| Migration-set SHA-256 | `29bd6c6f3ce78948cee5a5c4abb5f83adb99e94b9af941292b000d88f4c2d45e` |
| Source SHA | `a1b78a19786063b1cfc79ff14e14d352e929bf55` |
| Previous rollback release | `g13b-0.74.0-beta.5-cadf34dd4` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Host P state | Deferred / untouched |
| Legacy production | DEGRADED / FROZEN |

## Owner priority (2026-08-01)

```text
NOW:     AUTO-4 catch-up (includes PR #34 — still SENSITIVE / approval-required)
DONE:    AUTO-1 OPERATIONAL; AUTO-2 OPERATIONAL; AUTO-3 OPERATIONAL (this mission)
PARKED:  ISS-UI-001 / PR #28
NOTE:    PR #34 remains UNMERGED — no absorb onto Host D without owner approval + AUTO-3
```

## AUTO-3 — OPERATIONAL (this mission)

| Item | Value |
| --- | --- |
| Build workflow | `upstream-auto3-deploy.yml` (credential-free build zone) |
| Deploy identity | `appsolino-deploy` + env `host-d-staging` (forced-command SSH) |
| Deploy entry | `infra/scripts/auto3-deploy.sh` (staging + proof profiles) |
| Successful deploy | `auto3-0.74.0-beta.5-a1b78a197860` from CI-built archive via App-class identity |
| Rollback proof | proof profile `ROLLED_BACK` after deliberate smoke failure; live staging unchanged during drill |
| Idempotent second run | `IDEMPOTENT_NOOP` — pointer unchanged |
| Hotfix | PR #44 — receive heredoc no longer empties SSH stdin |
| PR #34 | **SENSITIVE** / `auto2:approval-required` / UNMERGED |
| Host P accessed | **NO** |

## AUTO-1 / AUTO-2

Remain OPERATIONAL. AUTO-2 finalizer dispatches AUTO-3 after eligible low-risk merges to main.

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| `testMode` | `false` |
| `enginePaused` | `true` |

## Current blockers

1. **AUTO-4** — process PR #34 / upstream backlog after owner approval.
2. **PR #34** — SENSITIVE; workflows + migrations + large changeset; Host D only via AUTO-3 after approval.
3. **ISS-GIT-007** — engine merge default-branch fix still open.
4. **ISS-UI-001** — PARKED (PR #28).

## Milestone board

```text
G0: COMPLETE
G1: PASS
AUTO-1: OPERATIONAL
AUTO-2: OPERATIONAL
AUTO-3: OPERATIONAL
AUTO-4: NOW
ISS-UI-001: PARKED
```

## Next authorised mission

**AUTO-4** — do not merge PR #34 without owner approval; keep ISS-UI-001 parked.
