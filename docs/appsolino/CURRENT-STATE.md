# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-07T13:55:00Z

| Field | Value |
| --- | --- |
| Active programme | Issue [#109](https://github.com/Appsolino/Fusion/issues/109) — Host D trust-hardening |
| Prior programmes | [#78](https://github.com/Appsolino/Fusion/issues/78) CLOSED · [#105](https://github.com/Appsolino/Fusion/issues/105) CLOSED |
| Appsolino main tip | look up live tip with `git fetch && git rev-parse origin/main` |
| Integrated upstream (main freshness file) | still pre-#135 absorb — **not FRESH** |
| Live Runfusion HEAD | `fc2040ca84762f6460e5259a8052af5eadab2a9f` |
| Active upstream candidate | [#135](https://github.com/Appsolino/Fusion/pull/135) `automation/upstream-fc2040ca8476` (deterministic validate SUCCESS; still labeled expert-resolving until latency PR lands) |
| Active Host D release | `auto3-0.75.1-beta.1-7c62e652e56d` |
| Schema ceiling | **0044** |
| Staging health | `ok` / `0.75.1-beta.1` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Host P state | **accessed=NO — prohibited** |
| Operating mode | **HOST-D TRUST HARDENING** · continuous automation continues |

## Maintenance plane (this cycle)

| Item | State |
| --- | --- |
| AI verifier protocol | Landed [#132](https://github.com/Appsolino/Fusion/pull/132) — `AI_PROTOCOL_ERROR` taxonomy, ≤3 retries, SHA-bound verdicts |
| Expert integrity false-positive | Landed [#134](https://github.com/Appsolino/Fusion/pull/134) |
| Expert/verifier hard-kill timeout | Landed [#137](https://github.com/Appsolino/Fusion/pull/137) |
| Expert problemType coerce | Landed [#138](https://github.com/Appsolino/Fusion/pull/138) |
| Verifier diff evidence + push repairs | Landed [#139](https://github.com/Appsolino/Fusion/pull/139) |
| Latency audit | Docs on `feat/maintenance-latency-audit` — see `MAINTENANCE-LATENCY-AUDIT.md` |
| Latency architecture | **IN FIX** — `SENSITIVE_REVIEW` vs `REPAIR_REQUIRED`, cycle budget, stale watchdog, latency artifact/report (`ISS-UP-LATENCY-001`) |
| AUTO-1 owner parking | Removed for `automation/upstream-*` (no `auto2:approval-required` default) |
| `FIX-LANE-WIRING-TOUCH-FIXTURE` | **RETIRED** / `UPSTREAM_FIXED` on candidate #135 (vs `5e718544…`); not yet on main until absorb finalizes |
| Freshness | **not FRESH** — awaiting sensitive-review path after latency PR lands (do not owner-bypass #135) |
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
NOW:     Land latency architecture (SENSITIVE_REVIEW + cycle budget) → re-drive #135 via read-only review → FRESH
HOLD:    Host P / production — PROHIBITED; do not unpause Host D solely for maintenance proof
CLOSED:  Programme #78 · Issue #105
NOTE:    AI resolver is for a known problem; AI verifier is for uncertainty/risk
NOTE:    Do not weaken fail-closed validation to reduce latency
```
