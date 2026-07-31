# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-07-31T16:45:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `19971cd9f` |
| Active Host D release | `g13b-0.74.0-beta.5-cadf34dd4` |
| Executable SHA-256 | `3b0f701b7e3fe3c7b5441f784dadb659d439378cc7d858a5bc743463e9cea82a` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Staging result | **G1 PASS** retained on `g13b`. ISS-UI candidates preserved inactive. |
| Host P state | Deferred |
| Legacy production | DEGRADED / FROZEN |

## Owner priority (2026-07-31)

```text
NOW:     AUTO-2
NEXT:    AUTO-3
BACKLOG: AUTO-4 catch-up
DONE:    AUTO-1 OPERATIONAL (live App-identity + idempotency proven)
PARKED:  ISS-UI-001 / PR #28 (do not merge)
NOTE:    Open AUTO-1 absorb PR #34 must NOT be merged until AUTO-2/AUTO-3 gates exist
```

## AUTO-1 live proof (2026-07-31) — OPERATIONAL

| Item | Value |
| --- | --- |
| Source / harness | PASS (PR #29) |
| Secrets present | `APPSOLINO_AUTOMATION_APP_ID`, `APPSOLINO_AUTOMATION_APP_PRIVATE_KEY` (names only) |
| Routine identity | `appsolino-fusion-automation[bot]` via `create-github-app-token@v3` |
| First green live run | [30647282116](https://github.com/Appsolino/Fusion/actions/runs/30647282116) |
| Idempotent pair | [30647935103](https://github.com/Appsolino/Fusion/actions/runs/30647935103) + [30647998869](https://github.com/Appsolino/Fusion/actions/runs/30647998869) → same PR #34 |
| Automation branch | `automation/upstream-73bff5f88cf2` |
| Automation PR (open, unmerged) | https://github.com/Appsolino/Fusion/pull/34 |
| Duplicate PR on same tip | NO (pair reused #34) |
| Superseded tip PRs | #31–#33 closed without merge after upstream tip advanced during earlier dispatches |
| Appsolino `main` during proof | unchanged `19971cd9f` |
| Host D during proof | unchanged `g13b-0.74.0-beta.5-cadf34dd4` |
| Build / deploy in workflow | NO |
| Owner PAT / interactive OAuth in job | NO (`GH_CONFIG_DIR` = runner temp) |

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| DeepSeek | Stored; **not used for G1** |
| Fallback during G1 | unset / unused |
| `testMode` | `false` |

## Current blockers

1. **AUTO-2** — risk classify / package / staging candidate for upstream absorb (NOW).
2. **ISS-GIT-007** — engine task-merge default-branch fix still required before AUTO-3 auto-merge trust.
3. **ISS-UI-001** — PARKED (PR #28 open; not FIXED).
4. **AUTO-3…AUTO-4** — not started.

## Milestone board

```text
G0: COMPLETE
ISS-CLI-004: FIXED
ISS-CLI-005: FIXED
G1 physical-edit: PASS (KB-003) on g13b
AUTO-1: OPERATIONAL
AUTO-2: NOW
AUTO-3: NEXT
AUTO-4: BACKLOG
ISS-UI-001: PARKED (PR #28)
```

## Next authorised mission

**AUTO-2** — do not merge PR #34 onto Appsolino main as part of AUTO-1 leftovers; do not deploy Host D from AUTO-1. Keep ISS-UI-001 / PR #28 parked.
