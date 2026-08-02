# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-01T18:15:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `cce02cc7bc489268af8b722f98ec27628054add1` (PR #58 terminal-marker + version passthrough) |
| Active Host D release | `auto3-0.74.0-beta.6-16f24ed3b473` |
| Source SHA | `16f24ed3b47321cc1b5aa693b2fac7e13a00b379` (PR #55 absorb) |
| Previous rollback release | `auto3-0.74.0-beta.5-5f1b923bd815` |
| Schema ceiling | **0039** |
| Staging health | `ok` / `0.74.0-beta.6` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Host P state | Deferred / untouched (**accessed=NO**) |
| Legacy production | DEGRADED / FROZEN |
| Operating mode | **CONTINUOUS UPSTREAM MAINTENANCE** |

## Owner priority (2026-08-01)

```text
NOW:     Land Reliability Steward S0 (observation) → enable triggers after fixture proof
DONE:    PR #55 sensitive absorb + Host D beta.6 deploy; PR #58 marker/version fixes
DONE:    AUTO-4 COMPLETE (pin 71576d953626)
PARKED:  ISS-UI-001 / PR #28 — product backlog after steward S0
PARKED:  ISS-GIT-007 — after steward S0 unless owner redirects
NOTE:    Engine stays paused. Host P untouched. Do not re-merge PR #47.
```

## Recent upstream absorb

| Item | Value |
| --- | --- |
| PR #55 | Merged — upstream `5786c87eff11` (sensitive; migration 0039; census baseline regenerated) |
| Merge SHA | `16f24ed3b47321cc1b5aa693b2fac7e13a00b379` |
| First AUTO-3 child | [30705088925](https://github.com/Appsolino/Fusion/actions/runs/30705088925) → **BLOCKED** (hardcoded beta.5 vs package beta.6) |
| False parent claim | Parent reported DEPLOYED from first log marker (script source) — fixed in PR #58 |
| PR #58 | Merged `cce02cc7bc489268af8b722f98ec27628054add1` — last-marker parse + `AUTO3_APPLICATION_VERSION` |
| Recovery AUTO-3 | [30705532077](https://github.com/Appsolino/Fusion/actions/runs/30705532077) → **DEPLOYED** |

## AUTO-4 — COMPLETE

| Item | Value |
| --- | --- |
| Pinned upstream | `71576d9536267a7835f352922a55831811717896` |
| Absorb PR | #47 (merged; do not re-merge) |
| Merge SHA | `3e6a0ad67262152fc846cc0134a424903f0b4dec` |

## AUTO-1 / AUTO-2 / AUTO-3 / Steward

| Lane | Status |
| --- | --- |
| AUTO-1 | OPERATIONAL |
| AUTO-2 | OPERATIONAL — exact `handoff_id` correlation (ISS-AUTO-003) |
| AUTO-3 | OPERATIONAL — last terminal marker; version passthrough; evidence artifact for S0 |
| Steward S0 | **Landing** — observation / fingerprint / issues only (see [`reliability/STEWARD-POLICY.md`](reliability/STEWARD-POLICY.md)) |
| Steward S1+ | NOT AUTHORISED |

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| `testMode` | `false` |
| `enginePaused` | `true` |

## Maintenance (non-blocking)

- **app-id → client-id:** When org/repo var `APPSOLINO_AUTOMATION_CLIENT_ID` is available, switch `create-github-app-token@v3` from `app-id` secret to `client-id` var.

## Current blockers

1. **Steward S0 PR** — observation must land before S1 repair agent.
2. **ISS-GIT-007** — engine merge default-branch fix (parked).
3. **ISS-UI-001** — PARKED (PR #28).

## Milestone board

```text
G0: COMPLETE
G1: PASS
AUTO-1: OPERATIONAL
AUTO-2: OPERATIONAL
AUTO-3: OPERATIONAL
AUTO-4: COMPLETE (pin 71576d953626)
Steward S0: IN PROGRESS (this mission)
Mode: CONTINUOUS UPSTREAM MAINTENANCE
ISS-UI-001: PARKED
ISS-GIT-007: PARKED
```

## Next authorised mission

1. Merge Steward S0; confirm fixture-replay + minute-17 schedule on main.
2. After S0 acceptance: authorise **S1** repair-agent missions (still no Host D deploy from agent).
3. Product backlog: ISS-UI-001 / ISS-GIT-007 when owner redirects.
