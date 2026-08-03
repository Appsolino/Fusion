# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-03T11:00:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `b83fd0eda83b1760b441454f852b8564f954bdf4` (PR #66 dedup) — classification fix landing |
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
NOW:     Land cron :37 re-registration → prove schedule → then S1A decision
HOLD:    S1A Expert Advisory Mode
DONE:    PR #66 fingerprint dedup; App Issues write; observe+upsert green
DONE:    AUTO-4 COMPLETE (pin 71576d953626)
PARKED:  ISS-UI-001 / PR #28
PARKED:  ISS-GIT-007
NOTE:    Engine stays paused. Host P untouched.
```

## Steward S0 enablement

| Item | Value |
| --- | --- |
| Status | **ENABLED** — observe/upsert/dedup green; **expected-state classifier repaired (PR #70)** |
| Issue #67 | **FALSE POSITIVE** — skipped AUTO-2 validate on ineligible branch (classifier fixed; close after clean reconcile) |
| Issue #64 | **FALSE POSITIVE (classifier)** — `ignored` / `approval-required` mapped to missing-child (classifier fixed; close after clean reconcile) |
| Issue #65 | Closed duplicate of #64 |
| Scheduled `:37` | Cron re-registration pending merge; unproven on current main lineage |

## AUTO-1 / AUTO-2 / AUTO-3 / Steward

| Lane | Status |
| --- | --- |
| AUTO-1 | OPERATIONAL |
| AUTO-2 | OPERATIONAL |
| AUTO-3 | OPERATIONAL |
| Steward S0 | **ENABLED** — classification repair in flight |
| Steward S1A | **HOLD / NOT AUTHORISED** |

## Next authorised mission

1. Merge expected-state classification repair; close #64/#67 with evidence; re-reconcile.
2. Confirm no recreated FP issues; prove minute-17.
3. Only then **AUTHORISE S1A**.
