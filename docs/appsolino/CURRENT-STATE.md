# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-01T08:30:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `5f1b923bd8157f0f4cde8500f4799bda3b868884` (PR #52 handoff proof) |
| Active Host D release | `auto3-0.74.0-beta.5-5f1b923bd815` |
| Source SHA | `5f1b923bd8157f0f4cde8500f4799bda3b868884` |
| Previous rollback release | `auto3-0.74.0-beta.5-3e6a0ad67262` |
| Schema ceiling | **0038** |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Host P state | Deferred / untouched (**accessed=NO**) |
| Legacy production | DEGRADED / FROZEN |
| Operating mode | **CONTINUOUS UPSTREAM MAINTENANCE** |

## Owner priority (2026-08-01)

```text
NOW:     Post-catch-up AUTO-1 (upstream ahead of AUTO-4 pin); then ISS-UI-001 / ISS-GIT-007
DONE:    AUTO-4 COMPLETE; AUTO-3 handoff correlation LIVE-PROVEN (PR #52)
NOTE:    Engine stays paused. Host P untouched. Do not re-merge PR #47.
```

## AUTO-4 — COMPLETE

| Item | Value |
| --- | --- |
| Pinned upstream | `71576d9536267a7835f352922a55831811717896` |
| Absorb PR | #47 → merge `3e6a0ad67262152fc846cc0134a424903f0b4dec` |
| First Host D release | `auto3-0.74.0-beta.5-3e6a0ad67262` |

## AUTO-3 handoff correlation — LIVE PROVEN

| Item | Value |
| --- | --- |
| Correction PRs | #51 (handoff) + #53 (YAML heredoc restore) |
| Proof PR | #52 (`auto2-proof/handoff-correlation-…`) low-risk docs |
| Parent finalize | [run 30691423651](https://github.com/Appsolino/Fusion/actions/runs/30691423651) |
| Handoff ID | `auto2-30691423651-1-5f1b923bd815-5ccedbe0` |
| Selected AUTO-3 child | [run 30691437372](https://github.com/Appsolino/Fusion/actions/runs/30691437372) (exact name match; older failed `30679116104` ignored) |
| Child terminal | **DEPLOYED** |
| Source SHA | `5f1b923bd8157f0f4cde8500f4799bda3b868884` |
| Active release after proof | `auto3-0.74.0-beta.5-5f1b923bd815` |
| Parent JSON action | `auto-merged-deployed` |
| Parent Actions conclusion | failure on summary SyntaxError after success (fixed in follow-up) |
| Host P accessed | **NO** |
| `enginePaused` | **true** |

## AUTO-1 / AUTO-2 / AUTO-3

| Lane | Status |
| --- | --- |
| AUTO-1 | OPERATIONAL — post-catch-up pending (Runfusion main ahead of pin) |
| AUTO-2 | OPERATIONAL — exact handoff correlation proven |
| AUTO-3 | OPERATIONAL |

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| `testMode` | `false` |
| `enginePaused` | `true` |

## Maintenance (non-blocking)

- **app-id → client-id:** migrate `create-github-app-token@v3` to `client-id: vars.APPSOLINO_AUTOMATION_CLIENT_ID` when available.

## Milestone board

```text
G0: COMPLETE
G1: PASS
AUTO-1: OPERATIONAL
AUTO-2: OPERATIONAL (handoff correlation proven)
AUTO-3: OPERATIONAL
AUTO-4: COMPLETE (pin 71576d953626)
Mode: CONTINUOUS UPSTREAM MAINTENANCE
ISS-UI-001 / ISS-GIT-007: next after AUTO-1 catch-up PR
```
