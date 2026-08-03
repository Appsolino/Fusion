# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-03T09:50:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `a527d77c353b6cfe93b715e5217dfe18c8470a61` (PR #63 docs) — dedup fix pending merge |
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
NOW:     Land Steward S0 upsert fingerprint dedup → re-reconcile → prove :17
HOLD:    S1A Expert Advisory Mode
DONE:    Automation App Issues write granted; manual reconcile upsert succeeds
DONE:    PR #63 docs; PR #62 import fix; PR #59 S0 enabled
DONE:    Collapsed duplicate steward #65 into canonical #64
DONE:    AUTO-4 COMPLETE (pin 71576d953626)
PARKED:  ISS-UI-001 / PR #28
PARKED:  ISS-GIT-007
NOTE:    Engine stays paused. Host P untouched. Keep app-id identity until later.
```

## Steward S0 enablement

| Item | Value |
| --- | --- |
| Status | **ENABLED** — observe + upsert auth **GREEN**; same-batch fingerprint dedup repair landing |
| PR #59 / #61 / #62 / #63 | Merged on main through `a527d77c353b6cfe93b715e5217dfe18c8470a61` |
| App Issues permission | **GRANTED** (installation approved) |
| Manual reconcile (post-permission) | [30798731370](https://github.com/Appsolino/Fusion/actions/runs/30798731370) → observe **PASS**, upsert **PASS** |
| Dedup defect | Same fingerprint `sha256:09e76df5…` opened #64 and #65 in one batch (Search API lag) — **S0 acceptance fail until fixed** |
| Collapse | #65 closed as duplicate of #64; both occurrences retained on #64 |
| Canonical incident | [#64](https://github.com/Appsolino/Fusion/issues/64) `missing-child-timeout` — **historical** (past AUTO-2 waiters without child); keep open until classified closed after review |
| Scheduled `:17` | No successful schedule on current main lineage as of 2026-08-03T09:41Z (last schedule 07:44Z still on old SHA) |

## Incident classification (2026-08-03)

| Issue | Fingerprint | Classification | Treatment |
| --- | --- | --- | --- |
| #64 | `09e76df5…` | Historical / likely resolved handoff waits | Keep open as durable record; do not treat as active deploy incident |
| #65 | same | Duplicate of #64 (Search lag) | **Closed** |

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
| Steward S0 | **ENABLED** — upsert works; **dedup repair required** before acceptance |
| Steward S1A | **HOLD / NOT AUTHORISED** |
| Steward S1B | **NOT AUTHORISED** |
| Steward S2+ | NOT AUTHORISED |

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| `testMode` | `false` |
| `enginePaused` | `true` |

## Maintenance (deferred)

- **app-id → client-id:** Still deferred. Do not change identity config until S0 acceptance completes.

## Current blockers

1. **Steward upsert same-batch fingerprint dedup** — this PR; then re-reconcile must not create a second open issue for `09e76df5…`.
2. **Minute-17 schedule proof** on current main — still outstanding.
3. **ISS-GIT-007** / **ISS-UI-001** — parked.

## Milestone board

```text
G0: COMPLETE
G1: PASS
AUTO-1: OPERATIONAL
AUTO-2: OPERATIONAL
AUTO-3: OPERATIONAL
AUTO-4: COMPLETE
Steward S0: ENABLED (dedup repair in flight; :17 pending)
Steward S1A: HOLD
Mode: CONTINUOUS UPSTREAM MAINTENANCE
```

## Next authorised mission

1. Merge this upsert dedup repair; rerun `mode=reconcile`; confirm one open issue per fingerprint.
2. Confirm one green minute-17 schedule on current main.
3. Only then request **AUTHORISE S1A**.
4. Product backlog: ISS-UI-001 / ISS-GIT-007 when owner redirects.
