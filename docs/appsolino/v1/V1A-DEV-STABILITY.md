# V1A.1 — Host D extended development stability

Last updated: 2026-07-30

result: **FAIL**

date (UTC): 2026-07-30
hostname: `vmi3201923` (Host D)

## Candidate (unchanged)

- release ID: `v1a-0.74.0-beta.5-f54d53082`
- executable SHA-256: `5f33e09a2a004318b015e341dd37c88b841c3eea572e53f89658d51529b7ce4a`
- archive SHA-256: `9a3c275a34e39004d0c026e3b2a864b6f4064d174618d7f4383c3b62c7ae6598`
- source: `f54d53082f08a4d8236dc21980c9ae4ec3d13671`
- CANDIDATE_REBUILT: NO

## Scenarios performed

Disposable repos (no remotes):

- `/srv/appsolino-fusion/staging/disposables/v1a1-repo-a` @ `b40abd04c900d7c9bd071d9df0b0e534eb082bbd`
- `/srv/appsolino-fusion/staging/disposables/v1a1-repo-b` @ `c46dc168211dee8f9dfe6ec6923ec0044106d6a5`

Registered project: `proj_f28f2ccde85b478b` (`v1a1-repo-a`).
No production AI credentials on Host D (`secrets.env` has only DB keys). Enabled `testMode` to exercise the real Fusion path with the built-in mock runtime.

| Scenario | Task ID | Terminal / observed | Notes |
| --- | --- | --- | --- |
| A read-only | VARE-001 | FAIL then redispatch loop | mock executor; worktree created |
| B write | VARE-002 | FAIL then redispatch loop | same |
| C modify | VARE-003 | FAIL then redispatch loop | same |
| D git | VARE-004 | FAIL then redispatch loop | same |
| E independent | VARE-005 | queued / failed attempts | same repo; distinct worktrees |
| Concurrent (A–E overlap) | — | Distinct worktrees observed | e.g. `vivid-crane`, `dusky-eagle`, `deft-peach`; maxConcurrent=2 |
| Controlled failure | — | Not separately needed | Execute path already failed unstably |
| Restart recovery | — | PARTIAL / FAIL | See below |

Requested file changes from A–E: **not applied** (repo stayed at initial commit content).

## Real engine/agent path

result: **PASS (path proven) / FAIL (execution outcome)**

Evidence:

- Coordinator accepted tasks (`[plan] Specifying VARE-…`).
- Mock triage wrote `PROMPT.md`; plan-review approved scripted output.
- Executor runtime `mock` started; agent assignment recorded (`agent-a64342cc`).
- Worktrees under `…/v1a1-repo-a/.worktrees/<name>`; branches `fusion/vare-00N`.
- Service identity: `fusion` user; `fusion-staging.service`.

## Primary defect (blocking)

**Mock executor step indexing error → unstable execute failure loop**

1. Executor repeatedly calls `fn_task_update` for steps; then errors: `Step 4 out of range (task has 4 steps)` (0-based steps 0–3).
2. Workflow terminates: `Workflow graph terminated with failure at node 'steps#0:step-execute'`.
3. Task moves `in-progress` → `todo` and is **re-dispatched** (new worktrees / new runIds) instead of parking in one clear failed/paused actionable state.
4. Operator pause was required to stop the storm.

Reproduction: register disposable project → `PUT /api/settings?projectId=…` with `testMode:true, enginePaused:false` → create normal tasks via `POST /api/tasks?projectId=…`.

## Secondary defect (restart)

**Immutable staging install strips execute bits from `runtime/` helpers**

`install-staging-release.sh` sets all release files to mode `0644` except `fn`. After restart with `testMode` / embedded-postgres attempt:

- `EACCES: permission denied, posix_spawn '…/runtime/linux-x64/embedded-postgres/native/bin/initdb'`
- Health stuck at `{"status":"starting","holding":true}` for minutes; API 503.

Operational recovery (not a product patch; **fn hash unchanged**): restore `+x` on `runtime/.../native/bin/*`, clear `testMode` in staging settings, restart. Health returned to `ok` / `0.74.0-beta.5`.

## Concurrency

Distinct worktree identities observed under load of five tasks with `maxConcurrent=2`. Isolation of successful file edits **not proven** (no successful writes). No shared-branch merge contamination observed because work did not complete.

## Controlled failure

Designed missing-command failure not reached. Observed execute failure was **not** stable: repeated todo↔in-progress cycles until paused.

## Restart recovery

- Completed/failed task rows remained addressable **before** the stuck-start window.
- After restart, prolonged `starting/holding` / 503 until runtime-bit recovery.
- Candidate hash unchanged: YES.
- Staging restored to healthy after ops recovery.

## Resources (summary)

| | Before (approx) | After recovery |
| --- | --- | --- |
| Mem available | ~9.6 Gi | ~9.7 Gi |
| Swap used | ~1 Gi | ~1 Gi |
| Disk `/` | 18% | 18% |
| Listeners | `127.0.0.1:4140` only | same |
| Restore DBs | none | none (`fusion_staging` only) |

No runaway CPU observed after operator pause. Leftover worktrees under disposable repo (cleaned or left for inspection per operator preference).

## Significant log findings

- Mock path: triage → plan-review → executor.
- `Execution failed: Step 4 out of range (task has 4 steps)`.
- Out-of-order step done ignored while Preflight still in-progress.
- Restart: embedded-postgres `initdb` EACCES under non-executable runtime bits.

## Unresolved defects (narrow correction missions proposed)

1. **Mock/testMode executor step script**: stop attempting step index 4 when the task has 4 steps (0–3); complete or fail closed without redispatch storm.
2. **Execute-failure parking**: graph failure at `step-execute` must reach one stable failed/paused actionable state without infinite todo requeue.
3. **Staging install permissions**: preserve execute bits on `runtime/**` binaries when making release trees immutable (or document + test that embedded/helpers remain runnable).

Do **not** rebuild the frozen candidate unless a corrected package is intentionally cut after those fixes.

## Explicit statements

- HOST_P_ACCESSED: NO
- PRODUCTION_IDENTITIES_ON_HOST_D: ABSENT
- LEGACY_PRODUCTION_TOUCHED: NO
- CANDIDATE_REBUILT: NO
- V1B_STARTED: NO
