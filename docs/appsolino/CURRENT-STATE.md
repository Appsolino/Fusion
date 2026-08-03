# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-03T08:35:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `e4a0058c6b3e6a3c059195175e19d2eec71686dd` (PR #62 reconcile import-side-effect fix) |
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
NOW:     Grant Appsolino Automation App Issues write on Appsolino/Fusion; re-run reconcile + confirm :17
HOLD:    S1A Expert Advisory Mode (observe fixed; issue persistence not yet proven)
DONE:    PR #62 import-side-effect repair merged on main
DONE:    Post-merge fixture-replay 30796450732 PASS (upsert skipped; zero fixture issues)
DONE:    Manual reconcile observe PASS (30796456559) — schedule-shaped path reaches reconcileRuns
DONE:    PR #61 docs ledger; PR #59 Steward S0 enabled
DONE:    AUTO-4 COMPLETE (pin 71576d953626)
PARKED:  ISS-UI-001 / PR #28
PARKED:  ISS-GIT-007
NOTE:    Engine stays paused. Host P untouched.
```

## Steward S0 enablement

| Item | Value |
| --- | --- |
| Status | **ENABLED** — observation path **GREEN** after PR #62; issue upsert **BLOCKED** (App install perms) |
| PR #59 | Merged — approved head `8a3743c7509e6ce167a37aabf439ca4dd58b2203` |
| Docs PR #61 | Merged `da3d6574927d04e2dafa024d79f95b1ff0439381` |
| Repair PR #62 | Merged `e4a0058c6b3e6a3c059195175e19d2eec71686dd` — `live-evidence.mjs` + `isMain` CLI guards |
| Import defect | Fixed — no longer executes `run-live-event` CLI when reconcile imports shared helpers |
| Fixture replay (post-fix) | [30796450732](https://github.com/Appsolino/Fusion/actions/runs/30796450732) → **PASS** (observe success; upsert skipped) |
| Manual reconcile | [30796456559](https://github.com/Appsolino/Fusion/actions/runs/30796456559) → observe **PASS**; upsert **FAIL** |
| Upsert failure | App token create: `The permissions requested are not granted to this installation` (requested `permission-issues: write` via `app-id`; warning to prefer `client-id`) |
| Scheduled `:17` on new main | Not yet observed on `e4a0058…` as of 2026-08-03T08:27Z; waiting for next cron fire |
| Steward issues opened | **None** — upsert never completed |

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
| Steward S0 | **ENABLED** — observe/reconcile logic green; **issue write blocked** |
| Steward S1A | **HOLD / NOT AUTHORISED** |
| Steward S1B | **NOT AUTHORISED** |
| Steward S2+ | NOT AUTHORISED |

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| `testMode` | `false` |
| `enginePaused` | `true` |

## Maintenance (non-blocking → blocking for S0 issue path)

- **Automation App Issues permission (BLOCKING for S0 acceptance):** Installation must grant Issues write so steward upsert can mint `permission-issues: write`. Optionally migrate `create-github-app-token@v3` from deprecated `app-id` secret to org/repo `client-id` var `APPSOLINO_AUTOMATION_CLIENT_ID` once available.

## Current blockers

1. **Steward issue upsert App permissions** — observe finds candidates; cannot open/update Issues until installation grants Issues write.
2. **Minute-17 proof on `e4a0058…`** — pending next schedule fire (manual reconcile already exercised schedule-shaped observe).
3. **ISS-GIT-007** / **ISS-UI-001** — parked.

## Milestone board

```text
G0: COMPLETE
G1: PASS
AUTO-1: OPERATIONAL
AUTO-2: OPERATIONAL
AUTO-3: OPERATIONAL
AUTO-4: COMPLETE (pin 71576d953626)
Steward S0: ENABLED (observe GREEN; upsert RED — App perms)
Steward S1A: HOLD
Mode: CONTINUOUS UPSTREAM MAINTENANCE
```

## Next authorised mission

1. **Owner:** Grant Appsolino Automation App **Issues** write on `Appsolino/Fusion` (and prefer `client-id` when the org var exists).
2. Re-run steward `workflow_dispatch` `mode=reconcile`; confirm upsert succeeds; classify any issues (legitimate / historical / false positive).
3. Confirm one green minute-17 schedule on current main.
4. Only then request **AUTHORISE S1A** (draft: [`reliability/S1A-MISSION-DRAFT.md`](reliability/S1A-MISSION-DRAFT.md)).
5. Product backlog: ISS-UI-001 / ISS-GIT-007 when owner redirects.
