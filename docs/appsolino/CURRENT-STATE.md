# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-03T08:05:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `da3d6574927d04e2dafa024d79f95b1ff0439381` (PR #61 docs: S0 ENABLED / S1A HOLD) |
| Active Host D release | `auto3-0.74.0-beta.6-16f24ed3b473` |
| Source SHA | `16f24ed3b47321cc1b5aa693b2fac7e13a00b379` (PR #55 absorb) |
| Previous rollback release | `auto3-0.74.0-beta.5-5f1b923bd815` |
| Schema ceiling | **0039** |
| Staging health | `ok` / `0.74.0-beta.6` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Host P state | Deferred / untouched (**accessed=NO**) |
| Legacy production | DEGRADED / FROZEN |
| Operating mode | **CONTINUOUS UPSTREAM MAINTENANCE** |

## Owner priority (2026-08-03)

```text
NOW:     Land Steward S0 reconcile import-side-effect fix → prove fixture + manual reconcile + :17
HOLD:    S1A Expert Advisory Mode until schedule reconcile PASS on main
DONE:    PR #61 docs ledger (S0 ENABLED; schedule red; S1A hold)
DONE:    PR #59 Steward S0 observation merged + enabled on main
DONE:    Fixture replay 30732734948 PASS (upsert skipped; zero issues)
DONE:    AUTO-4 COMPLETE (pin 71576d953626)
PARKED:  ISS-UI-001 / PR #28
PARKED:  ISS-GIT-007
NOTE:    Engine stays paused. Host P untouched. Do not re-merge PR #47 or #59.
```

## Steward S0 enablement

| Item | Value |
| --- | --- |
| Status | **ENABLED** on `main` (observation / fingerprint / issues only) |
| PR #59 | Merged — approved head `8a3743c7509e6ce167a37aabf439ca4dd58b2203` |
| Docs PR #61 | Merged `da3d6574927d04e2dafa024d79f95b1ff0439381` |
| Fixture replay | [30732734948](https://github.com/Appsolino/Fusion/actions/runs/30732734948) → **PASS** |
| Fast path `workflow_run` | Operational when no fall-through |
| Scheduled reconcile (`17 * * * *`) | **BROKEN on main until this repair merges** — import side effect |
| Root cause | `run-live-reconcile.mjs` imported `run-live-event.mjs`, whose unconditional `main()` exited with `require --repo and --run-id` on schedule (no `WR_ID`) — confirmed on [30782878193](https://github.com/Appsolino/Fusion/actions/runs/30782878193) |
| Repair | Extract side-effect-free `live-evidence.mjs`; guard CLI entrypoints with `isMain` |
| Steward issues opened | **None** while schedule red |

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
| Steward S0 | **ENABLED** — fixtures PASS; scheduled reconcile repair landing |
| Steward S1A | **NOT AUTHORISED / HOLD** |
| Steward S1B | **NOT AUTHORISED** |
| Steward S2+ | NOT AUTHORISED |

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| `testMode` | `false` |
| `enginePaused` | `true` |

## Maintenance (non-blocking)

- **app-id → client-id:** When org/repo var `APPSOLINO_AUTOMATION_CLIENT_ID` is available, switch `create-github-app-token@v3` from `app-id` secret to `client-id` var.

## Current blockers

1. **Steward S0 scheduled reconcile** — import side-effect repair must merge + prove (fixture, manual reconcile, minute-17).
2. **ISS-GIT-007** — parked.
3. **ISS-UI-001** — PARKED (PR #28).

## Milestone board

```text
G0: COMPLETE
G1: PASS
AUTO-1: OPERATIONAL
AUTO-2: OPERATIONAL
AUTO-3: OPERATIONAL
AUTO-4: COMPLETE (pin 71576d953626)
Steward S0: ENABLED (schedule repair in flight)
Steward S1A: HOLD
Mode: CONTINUOUS UPSTREAM MAINTENANCE
```

## Next authorised mission

1. Merge this reconcile import-side-effect repair; run fixture-replay + manual `reconcile` on main.
2. Confirm one green minute-17 schedule; classify any steward issues (legitimate / historical / false positive).
3. Only then request owner **AUTHORISE S1A** (draft: [`reliability/S1A-MISSION-DRAFT.md`](reliability/S1A-MISSION-DRAFT.md)).
4. Product backlog: ISS-UI-001 / ISS-GIT-007 when owner redirects.
