# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-04T07:40:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `be0aeee7710aba632a267d34737fd18cdeb0f2db` (PR #76 S1A merge) |
| Active Host D release | `auto3-0.74.0-beta.6-16f24ed3b473` |
| Source SHA | `16f24ed3b47321cc1b5aa693b2fac7e13a00b379` (PR #55 absorb) |
| Previous rollback release | `auto3-0.74.0-beta.5-5f1b923bd815` |
| Schema ceiling | **0039** |
| Staging health | `ok` / `0.74.0-beta.6` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Host P state | Deferred / untouched (**accessed=NO** — **prohibited**) |
| Legacy production | DEGRADED / FROZEN |
| Operating mode | **CONTINUOUS UPSTREAM MAINTENANCE** |

## Owner priority

S1A live engine: `cursor-cli` / `composer-2.5` on self-hosted `appsolino-fusion` (analyze) + GitHub-hosted writer.
 (2026-08-04)

```text
NOW:     Close S1A activation docs/label state; keep automatic handoff OFF
NEXT:    Separate decision: controlled S1A_AUTO_HANDOFF activation (then optional STEWARD_S0_HANDOFF_S1A)
HOLD:    S1B repair PR agent — NOT AUTHORISED
DONE:    S0 observation ACCEPTED (fingerprint, upsert, AUTO-1 conflict classification)
DONE:    S1A IMPLEMENTED + MANUAL LIVE PROOF PASS on issue #74 (PR #76 / be0aeee77)
DONE:    AUTO-4 COMPLETE (pin 71576d953626)
PARKED:  ISS-UI-001 / PR #28
PARKED:  ISS-GIT-007
NOTE:    Engine stays paused. Host P untouched / prohibited.
```

## Steward enablement

| Item | Value |
| --- | --- |
| S0 status | **ACCEPTED** — observation / upsert / reconcile on `main` |
| S1A status | **IMPLEMENTED / MANUAL LIVE PROOF PASS** — advice only; see [`reliability/S1A-EXPERT-ADVISORY.md`](reliability/S1A-EXPERT-ADVISORY.md) |
| S1B status | **NOT AUTHORISED** |
| Automatic S1A handoff | **OFF** pending separate activation (`S1A_AUTO_HANDOFF` / `STEWARD_S0_HANDOFF_S1A`) |
| Engine | **paused** |
| Host P | **prohibited** |

## AUTO-1 / AUTO-2 / AUTO-3 / Steward

| Lane | Status |
| --- | --- |
| AUTO-1 | OPERATIONAL |
| AUTO-2 | OPERATIONAL |
| AUTO-3 | OPERATIONAL |
| Steward S0 | **ACCEPTED** |
| Steward S1A | **IMPLEMENTED / MANUAL MODE ACTIVE** (advice only) |
| Steward S1B | **NOT AUTHORISED** |

## Next authorised mission

1. Keep **manual** S1A `workflow_dispatch` available for eligible Steward incidents.  
2. Automatic handoff remains **OFF** until a separate controlled activation.  
3. Do **not** authorise S1B, repair branches, Host D/P, or AUTO redispatch from Steward.  
4. Issue #74 advice is advisory only — S1B must not be authorised solely from that assessment.  
