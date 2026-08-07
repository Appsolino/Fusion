# Maintenance latency audit — historical findings

**Mission:** Eliminate long blind waits in Appsolino/Fusion autonomous maintenance.  
**Authority for this document:** measurement evidence before broad timeout redesign.  
**Analyzed at UTC:** 2026-08-07T13:45:00Z  
**Sample:** 20 `upstream-auto2-expert-resolve` runs (2026-08-07 focus) + companion AUTO-1 / AUTO-2 validate / finalize wall clocks + 14 expert outcome comments on #131/#133/#135.

Machine extracts:

- `.appsolino/proofs/latency-audit-expert-runs.json`
- `.appsolino/proofs/latency-audit-expert-outcomes.json`

---

## Historical findings (summary)

```text
runs analyzed (expert-resolve completed): 18
total wall-clock:                       324.6 min

PRODUCTIVE AI (expert step, mixed quality): 256.1 min  (78.9%)
INFRASTRUCTURE_WAIT (runner queue):         9.6 min   (3.0%)
SETUP_IO:                                   2.3 min   (0.7%)
residual (dispatch/job bookkeeping/other): 56.7 min   (17.5%)

Of expert outcomes on #131/#133/#135 (14 comments):
  AI_PROTOCOL / schema:     4
  AI_TIMEOUT / exit 143:    5
  VERIFIER_REQUEST_CHANGES / non-convergence: 1 (+ loops inside long runs)
  STALE_UPSTREAM / STALE_APPSOLINO_BASE: 3
  DETERMINISTIC false-positive integrity: 1
  REFRESH / race (productive detection): included in stale

AUTO-1 wall (n=15):     avg ~180s  p50 ~181s  p90 ~192s
AUTO-2 validate (n=13): avg ~24s   p50 ~30s
AUTO-2 finalize (n=15): avg ~29s   p50 ~27s
```

**Bottom line:** Ordinary maintenance CI (AUTO-1/2 validate/finalize) is already in the few-minute range. Almost all operational pain is concentrated in **SENSITIVE → edit-capable expert repair loops**, often when deterministic validation already passed.

---

## Per-run evidence (expert-resolve)

| Run | Conclusion | Queue | Setup | Expert step | Wall | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| [31169133069](https://github.com/Appsolino/Fusion/actions/runs/31169133069) | failure | **335s** | 8s | 607s | 1058s | Owner example: ~5m35s queue + ~10m expert |
| [31171067130](https://github.com/Appsolino/Fusion/actions/runs/31171067130) | failure | 2s | 6s | **2122s** | 2145s | Owner example: ~35m expert; later schema/protocol |
| [31178120100](https://github.com/Appsolino/Fusion/actions/runs/31178120100) | failure | 3s | 6s | **1969s** | 1989s | REQUEST_CHANGES exhaust after 3 repair attempts |
| [31163759429](https://github.com/Appsolino/Fusion/actions/runs/31163759429) | failure | 3s | 7s | 1563s | 1591s | False-positive deterministic integrity (pre-#134) |
| [31172952585](https://github.com/Appsolino/Fusion/actions/runs/31172952585) | failure | **75s** | 7s | 1336s | 1870s | Queue + long expert |
| [31176232624](https://github.com/Appsolino/Fusion/actions/runs/31176232624) | success* | **117s** | 5s | 536s | 1497s | *exit 0 = REFRESH_REQUIRED (Appsolino base moved) |
| [31178328167](https://github.com/Appsolino/Fusion/actions/runs/31178328167) | success* | 2s | 7s | 1234s | **3066s** | Long wall incl. bookkeeping / overlapping work |
| [31166497798](https://github.com/Appsolino/Fusion/actions/runs/31166497798) | success* | 2s | 6s | 430s | 450s | REFRESH_REQUIRED upstream tip move mid-cycle |
| [31166147731](https://github.com/Appsolino/Fusion/actions/runs/31166147731) | success* | 3s | 9s | **6s** | 30s | Fast REFRESH_REQUIRED (Appsolino base) — good pattern |
| [31167320606](https://github.com/Appsolino/Fusion/actions/runs/31167320606) | failure | 2s | 6s | 606s | 628s | Expert timeout 600s |
| [31161575357](https://github.com/Appsolino/Fusion/actions/runs/31161575357) | failure | 2s | 9s | 409s | 434s | Protocol malformed (pre-#132) |

\*GitHub `success` on expert-resolve often means “handled REFRESH_REQUIRED / exited 0”, not merge-finalizable.

### Aggregate (completed expert runs)

| Metric | Queue | Expert step | Wall |
| --- | ---: | ---: | ---: |
| n | 18 | 18 | 18 |
| avg | 32s | **14.2 min** | **18.0 min** |
| p50 | **2s** | **10.1 min** | **16.1 min** |
| p90 | 75s | **27.0 min** | **33.2 min** |
| max | **5.6 min** | **35.4 min** | **51.1 min** |

Expert step > 12 min: **7 / 18**. Runner queue > 60s: **3 / 18**.

---

## Latency taxonomy attribution

| Classification | Count (outcomes / runs) | Time evidence | Root cause | Example runs | Recommended fix |
| --- | ---: | --- | --- | --- | --- |
| **UNNECESSARY_EXPERT_INVOCATION** | Dominant pattern on #135 | Most of 256 min expert-step mass | SENSITIVE + AUTO-2 validate SUCCESS still dispatches **edit-capable** resolver | #135 all cycles; AUTO-2 report Risk=SENSITIVE, Validation=success | Split `SENSITIVE_REVIEW` (read-only verifier) vs `REPAIR_REQUIRED` |
| **AI_EXPERT_REASONING / TOOL_EXECUTION** | Inside every long expert step | Embedded in expert-step | Real model work + tool edits on large candidates | 31171067130, 31178120100 | Scope prompts; bound context; phase budgets |
| **VERIFIER_REQUEST_CHANGES + REPAIR_NON_CONVERGENCE** | Explicit on 31178120100; implied in multi-attempt loops | Multiplies expert+verifier | Repair loop 3 × verifier retries; same semantic REQUEST_CHANGES without targeted delta | 31178120100, 31171067130 | Feed exact `requiredChanges`; stop if no dirty delta; total cycle budget |
| **AI_SCHEMA_REPAIR / AI_PROTOCOL_RETRY** | 4 outcome comments | Wasted long sessions before fail | Malformed JSON / invalid `problemType` after minutes of work | #131; 31171067130 → later #132/#138 | Cheap schema-repair budget; coerce enums (done); never 15m engineering for format |
| **AI_TIMEOUT / AI_PROVIDER_EXIT** | 5 outcomes | 10–15m burns | Soft timeout; SIGTERM ignored; exit 143 | 31167320606, 31169133069, hung runs | Hard-kill (done #137); total cycle deadline; stall taxonomy |
| **STALE_APPSOLINO_BASE / STALE_UPSTREAM** | 3+ REFRESH outcomes | Often after productive AI already spent | Freshness only at attempt boundaries; mid-flight main moves | 31176232624, 31166497798, 31166147731 | 30–60s watchdog; kill child; REFRESH_REQUIRED |
| **RUNNER_QUEUE** | 3 spikes | 9.6 min total sample | Self-hosted pool contention; `cancel-in-progress: false` allows pile-up | 31169133069 (335s), 31176232624 (117s) | Dedicated label/pool; cancel superseded; queue SLO ≤60s p95 |
| **DETERMINISTIC_TESTS** (false positive) | 1 major | ~26 min on 31163759429 | Naive `<<<<<<<` grep | 31163759429 | Fixed #134 |
| **WORKFLOW_DISPATCH_DELAY / SETUP_IO** | All runs | Setup ~5–14s | Checkout/token/worktree | all | Acceptable |
| **FULL_CI** | Parallel PR Checks | Separate from expert wall | Gate/Lint/Build on candidate | PR Checks on #135 | Keep; not expert path |
| **UNKNOWN_LATENCY** | Residual ~17% | Job/updatedAt skew, overlapping runs | Incomplete instrumentation | 31178328167 wall vs expert | Mandatory phase artifact |

### Productive vs waste (judgment)

| Bucket | Estimate of expert-step mass | Rationale |
| --- | ---: | --- |
| PRODUCTIVE | ~20–30% | Real review/repair that changed candidate state |
| NECESSARY_WAIT | ~5% | Short queue/setup when healthy |
| RETRY_WASTE | ~25–35% | Protocol/schema/timeout/exit 143 repeats |
| STALE_WORK | ~10–15% | Work finished then REFRESH_REQUIRED |
| INFRASTRUCTURE_WAIT | ~3% of total wall | Runner queue spikes |
| UNKNOWN | remainder | Need heartbeat + phase artifacts |

---

## Top causes (ordered by impact)

### 1. UNNECESSARY_EXPERT_INVOCATION (architectural)

**Symptom:** Deterministic AUTO-2 validation already SUCCESS; risk SENSITIVE → `expert-resolving` with **edit-capable** composer session (“resolve an engineering problem”).

**Evidence:** #135 AUTO-2 report: Validation success + Risk SENSITIVE; then multi-ten-minute repair loops.

**Fix:** `SENSITIVE_REVIEW` = read-only independent verifier first. Resolver only on FAIL / conflict / REQUEST_CHANGES.

### 2. Multiplicative retry budgets (orchestration)

**Symptom:** 15m per child × expert attempts × verifier attempts → theoretical hour-scale ceilings; observed 35m single expert step.

**Evidence:** 31171067130 (~35m); 31178120100 (~33m); code: `DEFAULT_CURSOR_TIMEOUT_MS=900000`, repair max 3, verifier max 3; concurrency `cancel-in-progress: false`.

**Fix:** Single `cycleDeadline`; nested retries receive `min(phaseBudget, remainingCycleBudget)`; schema-repair ≪ engineering budget.

### 3. REPAIR_NON_CONVERGENCE / untargeted REQUEST_CHANGES

**Symptom:** Verifier returns schema-valid REQUEST_CHANGES; expert re-investigates whole candidate; attempt 3 still REQUEST_CHANGES.

**Evidence:** 31178120100 outcome; live process dumps showed attempt 1+2 REQUEST_CHANGES with `testsPassed: true`.

**Fix:** Pass exact `requiredChanges`; track OPEN/RESOLVED; stop if `filesChanged=[]` and dirty diff empty; verifier reviews delta.

### 4. STALE_WORK discovered late

**Symptom:** Minutes of AI after Appsolino main or Runfusion tip moved; only then REFRESH_REQUIRED.

**Evidence:** 31176232624 (base moved); 31166497798 (upstream tip); owner-facing mid-flight merges during latency fixes.

**Fix:** 30–60s freshness watchdog; SIGKILL child; cancel superseded runs.

### 5. RUNNER_QUEUE spikes (secondary but real)

**Symptom:** Job created → runner start delay up to 5.6 min; Cursor “waiting for expert” conflates queue + AI.

**Evidence:** 31169133069 queue 335s; p50 queue only 2s → spikes matter, median is fine.

**Fix:** Separate metrics; dedicated runner pool/label; cancel obsolete expert runs; p95 queue ≤ 60s target.

### 6. Protocol/schema failures after expensive work (mostly mitigated)

**Evidence:** #131 malformed JSON; 31171067130-era `problemType` enum after long session.

**Status:** #132/#138 largely fixed; keep cheap schema-repair path so this cannot recur as 15m burns.

---

## Proposed SLO (calibrated from sample)

| SLO | Target | Evidence basis |
| --- | --- | --- |
| Runner queue p50 | ≤ 5s | Observed p50 2s |
| Runner queue p95 | ≤ **60s** | Spikes 75–335s today |
| AUTO-1 wall p95 | ≤ 4 min | Observed ~3 min |
| AUTO-2 validate+finalize | ≤ 2 min combined | Observed ~1 min |
| **SENSITIVE_REVIEW** (read-only, no repair) | target ≤ **8 min**, hard ≤ **12 min** | Should replace most current expert walls |
| **REPAIR_REQUIRED** cycle | target ≤ **12 min**, hard ≤ **20 min** | Only when deterministic fail / REQUEST_CHANGES |
| Individual expert phase | ≤ **6 min** default; ≤ remaining cycle budget | Cut 15m default for analysis |
| Individual verifier phase | ≤ **4 min** default; ≤ remaining cycle budget | Observed ~3–5 min when healthy |
| Schema-repair / protocol retry | ≤ **90s** | Must not equal engineering budget |
| Total hard wall-clock per expert-maintenance cycle | **≤ 20 min** then `LATENCY_BUDGET_EXHAUSTED` | Prevents multiplicative 15m×N |

Do **not** adopt “15 min per child” as the cycle budget.

---

## Instrumentation contract (to implement next)

Every expert-maintenance run must emit `.appsolino/proofs/maintenance-latency-<runId>.json` with:

`dispatchDelayMs`, `runnerQueueMs`, `setupMs`, per-phase `{name,attempt,model,startedAt,endedAt,latencyMs,result}`, `promptChars` / `diffChars`, `totalWallClockMs`, `latencyClassification[]`, `wastedMs`, `cycleBudgetMs`, `remainingBudgetMs`.

Heartbeat ≥ every 60s while a child runs: phase, attempt, elapsed, budget remaining, last output activity, candidate SHAs.

Cursor sessions: any external job > 2 min requires the LONG-RUN STATUS block (not “waiting”).

---

## Implementation priority (after this report)

1. **SENSITIVE_REVIEW vs REPAIR_REQUIRED** (largest win)  
2. **Total cycle budget + phase budgets**  
3. **Stale-candidate watchdog + cancel superseded runs** (`cancel-in-progress` / concurrency by candidate SHA)  
4. **Targeted REQUEST_CHANGES + non-convergence stop**  
5. **Latency artifact + heartbeat + report CLI**  
6. **Runner pool / queue SLO** (measure contention after cancel policy)

Preserve fail-closed trust. Optimize by removing unnecessary edit agents, stale work, blind retries, and blind waits — not by skipping deterministic gates.

---

## Current #135

Continue normal freshness handling; do not owner-bypass. Use #135 / successors as live latency evidence while implementing instrumentation. Do not block updater recovery solely on latency tooling.
