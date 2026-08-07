# Appsolino Fusion — current state

<!-- latency-cycle-2026-08-07 -->
## Live maintenance cycle (2026-08-07)

Latency architecture landed (#141) + verifier budget 8m (#143). Dual race guard proven when main moved under #135. Rolling candidate is now #144 (`1f9b0e64…`). SENSITIVE_REVIEW runs verifier-first (no Composer on clean PASS path). Verifier REQUEST_CHANGES identified false patch retention from shell-executing bare regression file paths — fix in flight. Scheduled AUTO-1 must not rebuild while sensitive-review/expert owns the matching tip. Cursor Approval Agent still requests Anas966 on automation/upstream-* (cleared by AUTO-1/expert; automation should stop requesting owner for this pipeline).


**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-07T16:15:00Z

| Field | Value |
| --- | --- |
| Active programme | Issue [#109](https://github.com/Appsolino/Fusion/issues/109) — Host D trust-hardening |
| Prior programmes | [#78](https://github.com/Appsolino/Fusion/issues/78) CLOSED · [#105](https://github.com/Appsolino/Fusion/issues/105) CLOSED |
| Appsolino main tip | `9c23397d…` + pending verifier-budget fix (look up live tip with `git fetch && git rev-parse origin/main`) |
| Integrated upstream (main freshness file) | still pre-absorb — **not FRESH** |
| Live Runfusion HEAD | `fc2040ca84762f6460e5259a8052af5eadab2a9f` |
| Active upstream candidate | [#135](https://github.com/Appsolino/Fusion/pull/135) refreshed on post-#141 main; SENSITIVE_REVIEW proved verifier-first |
| Active Host D release | `auto3-0.75.1-beta.1-7c62e652e56d` |
| Schema ceiling | **0044** |
| Staging health | `ok` / `0.75.1-beta.1` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Host P state | **accessed=NO — prohibited** |
| Operating mode | **HOST-D TRUST HARDENING** · continuous automation continues |

## Maintenance plane (this cycle)

| Item | State |
| --- | --- |
| Latency architecture | Landed [#141](https://github.com/Appsolino/Fusion/pull/141) — `SENSITIVE_REVIEW` vs `REPAIR_REQUIRED`, cycle budget, stale watchdog |
| Live sensitive-review proof | Run `31194403316` — mode=`sensitive-review`, verifier-only ~5m22s, **no edit agent**, REQUEST_CHANGES → repair |
| Verifier phase budget | **IN FIX** — 4m killed opus (exit 143); raise to 8m from live calibration |
| `FIX-LANE-WIRING-TOUCH-FIXTURE` | **RETIRED** / `UPSTREAM_FIXED` retained on refreshed candidate |
| Freshness | **not FRESH** — awaiting repair→APPROVE→finalize after budget fix |
| Part B / Host D unpause | **not authorised** — remain paused |

## Steward enablement

| Gate | State |
| --- | --- |
| s1aAutoHandoff | ON |
| s0HandoffS1a | ON |
| s1bEnabled | ON |
| s2Enabled | ON |
| s3Enabled | ON |

## Owner priority

```text
NOW:     Land verifier 8m phase budget → repair→APPROVE → FRESH
HOLD:    Host P / production — PROHIBITED; do not unpause Host D solely for maintenance proof
NOTE:    AI resolver = known problem; AI verifier = uncertainty/risk (proved live on #135)
```
