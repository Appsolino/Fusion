# Appsolino Fusion — current state

<!-- latency-cycle-2026-08-07 / governance-2026-08-07 / full-autonomy-2026-08-07 -->
## Live maintenance cycle (2026-08-07)

**#144 MERGED** (absorb `1f9b0e64…`). Source freshness **FRESH / 0 behind** Runfusion main.
Follow-ups #149–#151 on main (review package enrichment, AI-verified merge, SHA-bound APPROVE).
Governance **#153 MERGED** (provenance, candidate lease, release-freshness, automation map, Cursor Approval Agent docs).

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-08T09:45:00Z

| Field | Value |
| --- | --- |
| Active programme | Issue [#109](https://github.com/Appsolino/Fusion/issues/109) — Host D trust-hardening + **full autonomy** (`feat/full-autonomy`) |
| Prior programmes | [#78](https://github.com/Appsolino/Fusion/issues/78) CLOSED · [#105](https://github.com/Appsolino/Fusion/issues/105) CLOSED |
| Appsolino main tip | `50ef752f492e386467d676cc8fa1100f2d17842b` — docs R3 checkpoint [#167](https://github.com/Appsolino/Fusion/pull/167); remediation for SOAK-R3-DEFECT-001 in flight |
| Source version | `0.75.1` (package.json) |
| Integrated upstream | `1f9b0e644abb27e19803637803d74e37d7c45ce2` — **FRESH / 0 behind** |
| Live Runfusion HEAD | `1f9b0e644abb27e19803637803d74e37d7c45ce2` |
| Active upstream candidate | none (post-#144) |
| Latest published GitHub Release | `v0.73.0` (2026-07-25) — **RELEASE_STALE** vs source `0.75.1` |
| Active Host D release | `auto3-0.75.1-ff3faf384039` until SOAK-R3 plugin-freshness AUTO-3 lands |
| Schema ceiling | check live after absorb (0045/0046 may be on Host D after AUTO-3) |
| Full autonomy | Soak #1/#2/#3 **FAILED**. R3 terminal: SOAK-R3-DEFECT-001 (stale FUSION_HOME Cursor plugin vs release bundle) — see `KNOWN-ISSUES.md` |
| Staging health | ok; project `enginePaused=true`; Cursor plugin enabled but **stale vs package** until remediation deploy |
| Host P state | **accessed=NO — prohibited** |
| Operating mode | **HOST-D TRUST HARDENING** · soak paused · SOAK-R3-DEFECT-001 remediation |

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
| Cursor Approval Agent on upstream | **DISABLED by owner** — verification pending on next `automation/upstream-*` PR; defensive reviewer cleanup kept ([ops note](upstream/CURSOR-APPROVAL-AGENT-EXCLUDE.md)) |
| Automation map | [AUTOMATION-MAP.json](upstream/AUTOMATION-MAP.json) + YAML drift test |
| Provenance | Durable sync-status evidence; fail-closed away from false EXACT_UPSTREAM |
| Release observation | AUTO-1 + finalize observe `RELEASE_STALE` (no auto-publish) |
| Part B / Host D unpause | **not authorised** |
| Soak #1 | **FAILED** — SOAK-DEFECT-001; evidence retained under `host-d-soak-evidence/soak-1/` |
| Soak R2 | **FAILED** — SOAK-R2-DEFECT-001; evidence retained under `host-d-soak-evidence/soak-r2/`; HOST2-* archived |
| Soak R3 | **FAILED** — SOAK-R3-DEFECT-001 (stale FUSION_HOME Cursor plugin); evidence under `host-d-soak-evidence/soak-r3/`; remain paused |
| Soak R4 | Prepared after plugin-freshness remediation deploy — remain paused until owner OK |

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
NOW:     Land + deploy SOAK-R3-DEFECT-001 bundled plugin freshness remediation; prepare Soak R4 checkpoint (remain paused)
NEXT:    Owner authorize Soak R4 unpause only after READY FOR SOAK R4: YES
HOLD:    Host P / production — PROHIBITED; do not unpause solely for maintenance
NOTE:    Preserve Soak #1/#2/#3 evidence; do not hide failed history
NOTE:    Do not auto-publish a GitHub Release on every upstream commit — version-change policy
```
