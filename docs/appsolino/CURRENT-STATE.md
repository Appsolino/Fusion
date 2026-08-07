# Appsolino Fusion — current state

<!-- latency-cycle-2026-08-07 / governance-2026-08-07 -->
## Live maintenance cycle (2026-08-07)

**#144 MERGED** (absorb `1f9b0e64…`). Source freshness **FRESH / 0 behind** Runfusion main.
Follow-ups #149–#151 on main (review package enrichment, AI-verified merge, SHA-bound APPROVE).
Governance cleanup in flight: exclude external Cursor Approval Agent from `automation/upstream-*`,
provenance+impact risk, candidate lease, release-freshness (`RELEASE_STALE`), automation map.

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-07T19:57:00Z

| Field | Value |
| --- | --- |
| Active programme | Issue [#109](https://github.com/Appsolino/Fusion/issues/109) — Host D trust-hardening |
| Prior programmes | [#78](https://github.com/Appsolino/Fusion/issues/78) CLOSED · [#105](https://github.com/Appsolino/Fusion/issues/105) CLOSED |
| Appsolino main tip | `7782fa76605f3c0836be2349911fcdd9277e74f1` (look up live tip with `git fetch && git rev-parse origin/main`) |
| Source version | `0.75.1` (package.json) |
| Integrated upstream | `1f9b0e644abb27e19803637803d74e37d7c45ce2` — **FRESH / 0 behind** |
| Live Runfusion HEAD | `1f9b0e644abb27e19803637803d74e37d7c45ce2` |
| Active upstream candidate | none (post-#144) |
| Latest published GitHub Release | `v0.73.0` (2026-07-25) — **RELEASE_STALE** vs source `0.75.1` |
| Active Host D release | `auto3-0.75.1-beta.1-7c62e652e56d` |
| Schema ceiling | check live after absorb (0045/0046 may be on Host D after AUTO-3) |
| Staging health | verify live; Host D may remain `enginePaused=true` |
| Host P state | **accessed=NO — prohibited** |
| Operating mode | **HOST-D TRUST HARDENING** · continuous automation continues |

## Freshness planes

| Plane | State |
| --- | --- |
| Source freshness | **FRESH** (integrated == Runfusion HEAD) |
| Release freshness | **RELEASE_STALE** (source `0.75.1` ≠ Latest Release `v0.73.0`; no auto-tag on absorb) |
| Deploy freshness | Host D separate; Host P prohibited |

## Maintenance plane

| Item | State |
| --- | --- |
| Latency architecture | Landed [#141](https://github.com/Appsolino/Fusion/pull/141) |
| AI-verified merge (no Anas966) | Landed [#150](https://github.com/Appsolino/Fusion/pull/150) / SHA bind [#151](https://github.com/Appsolino/Fusion/pull/151) |
| Absorb #144 | **MERGED** |
| `FIX-LANE-WIRING-TOUCH-FIXTURE` | **RETIRED** / `UPSTREAM_FIXED` |
| Cursor Approval Agent on upstream | **OVERLAP** — exclude `automation/upstream-*` ([ops note](upstream/CURSOR-APPROVAL-AGENT-EXCLUDE.md)) |
| Automation map | [AUTOMATION-MAP.json](upstream/AUTOMATION-MAP.json) |
| Part B / Host D unpause | **not authorised** |

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
NOW:     Scope Cursor Approval Agent 83ebd12a away from automation/upstream-*
NEXT:    Land automation-governance PR (map, provenance risk, lease, RELEASE_STALE)
HOLD:    Host P / production — PROHIBITED; do not unpause Host D solely for maintenance proof
NOTE:    Official upstream easy to absorb; Appsolino deltas get scrutiny; integration gets tests
NOTE:    Do not auto-publish a GitHub Release on every upstream commit — version-change policy
```
