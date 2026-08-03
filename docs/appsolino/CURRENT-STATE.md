# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-03T07:45:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `1781538cc21ac54e99b476c850267de4c66eef97` (PR #59 Steward S0 merge) |
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
NOW:     Fix Steward S0 scheduled reconcile (minute-17) — S0 acceptance gap
HOLD:    S1A Expert Advisory Mode (do not authorise until reconcile PASS)
DONE:    PR #59 Steward S0 observation merged + enabled on main
DONE:    Fixture replay 30732734948 PASS (upsert skipped; zero issues)
DONE:    PR #55 sensitive absorb + Host D beta.6 deploy; PR #58 marker/version fixes
DONE:    AUTO-4 COMPLETE (pin 71576d953626)
PARKED:  ISS-UI-001 / PR #28 — product backlog after steward reconcile green
PARKED:  ISS-GIT-007 — unless owner redirects
NOTE:    Engine stays paused. Host P untouched. Do not re-merge PR #47 or #59.
```

## Steward S0 enablement

| Item | Value |
| --- | --- |
| Status | **ENABLED** on `main` (observation / fingerprint / issues only) |
| PR #59 | Merged — approved head `8a3743c7509e6ce167a37aabf439ca4dd58b2203` |
| Merge SHA | `1781538cc21ac54e99b476c850267de4c66eef97` |
| Fixture replay | [30732734948](https://github.com/Appsolino/Fusion/actions/runs/30732734948) → **PASS** (observe success; upsert skipped; zero fixture issues) |
| Fast path `workflow_run` | Running; successful observes observed (upsert skipped when no candidates) |
| Scheduled reconcile (`17 * * * *`) | **FAILING** — every post-merge schedule run fails in observe; upsert skipped |
| Latest schedule failure | [30782878193](https://github.com/Appsolino/Fusion/actions/runs/30782878193) — `run-live-event.mjs`: `require --repo and --run-id` on `EVENT_NAME=schedule` |
| Steward issues opened | **None** (no `appsolino-steward` / `s0-observation` issues found) |
| False-positive assessment | N/A — no issues to classify; schedule path has not reconciled yet |

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
| Steward S0 | **ENABLED** — fixtures PASS; scheduled reconcile **RED** (acceptance incomplete) |
| Steward S1A | **NOT AUTHORISED** — advice-only expert (draft only; see policy) |
| Steward S1B | **NOT AUTHORISED** — repair-PR mode |
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

1. **Steward S0 scheduled reconcile FAILING** — minute-17 observe exits via `run-live-event` without a run id; authoritative recovery path not proven.
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
Steward S0: ENABLED (fixture PASS; schedule reconcile RED)
Steward S1A: HOLD — not authorised
Mode: CONTINUOUS UPSTREAM MAINTENANCE
ISS-UI-001: PARKED
ISS-GIT-007: PARKED
```

## Next authorised mission

1. **Diagnose and fix Steward S0 scheduled reconcile** so minute-17 observe succeeds (and optional `workflow_dispatch` `reconcile` matches). Do not change S0 security trust zones.
2. Confirm at least one green schedule (or manual reconcile) after the fix; classify any newly opened steward issues as legitimate / historical / false positive.
3. **Only then** request owner authorisation for **S1A Expert Advisory Mode** (advice-only; no repair PRs / deploy / Host P). Draft: [`reliability/S1A-MISSION-DRAFT.md`](reliability/S1A-MISSION-DRAFT.md).
4. Product backlog: ISS-UI-001 / ISS-GIT-007 when owner redirects.
