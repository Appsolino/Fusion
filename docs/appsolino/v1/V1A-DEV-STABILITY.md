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

---

# V1A.2 — Corrected Host D stability retest

Last updated: 2026-07-30

result: **PASS WITH OBSERVATIONS**

date (UTC): 2026-07-30
hostname: `vmi3201923` (Host D)

## Merges

- PR #12 Correction A merge: `0b9d17857bfecc71d1f0a86e4b7fe7abb9b7513d`
- PR #13 Correction B merge: `3bc46bffe5fd217206f2f993753445f645374431`
- Corrected source SHA (main after #13): `3bc46bffe5fd217206f2f993753445f645374431`

## Corrected candidate

- release ID: `v1a2-0.74.0-beta.5-3bc46bffe`
- version: `0.74.0-beta.5`
- executable SHA-256: `4d58e8a1205a0334e6506427bc588a2ac6e76f2aa01b852610b93dedee0d2829`
- archive SHA-256: `7d86831a11a2bdde0cd3d2facdbffb76e97bc79c5ab36e74d2307cec57143524`
- migration-set SHA-256: `846da68e7c82f3acd9e8cfd847b4fd49a4e14251571e8063f0ed66e90282a570`
- build timestamp (UTC): `2026-07-30T17:21:50+00:00`
- toolchain: Node `v22.23.1`, pnpm `10.33.0`, Bun `1.3.14`
- artefact path: `/srv/appsolino-fusion/build/v1a/v1a2-0.74.0-beta.5-3bc46bffe`
- staging release: `/opt/appsolino-fusion/staging/releases/v1a2-0.74.0-beta.5-3bc46bffe`

### Old candidate preserved

- release: `v1a-0.74.0-beta.5-f54d53082`
- executable SHA-256 unchanged: `5f33e09a2a004318b015e341dd37c88b841c3eea572e53f89658d51529b7ce4a`
- OLD_CANDIDATE_MUTATED: NO

## Install / permission result

- Installer: Correction A `install-staging-release.sh` (immutable, execute-bit preserving).
- Executable inventory packaged ↔ installed: MATCH.
- `initdb` / `postgres` helpers remain executable after install and restart.
- No writable bits retained under the V1A.2 release tree.
- Atomic `current` switch to `v1a2-0.74.0-beta.5-3bc46bffe`.
- Observation: embedded-postgres startup logs `EPERM` when attempting `chmod` on immutable release helpers; init still succeeds and health reaches `ok` (no EACCES / no prolonged 503).

## Service validation

- `fusion-staging.service` active; health `ok` / `0.74.0-beta.5` within a short readiness window.
- Listener: `127.0.0.1:4140` only.
- Staging DB identity for migrations check: `fusion_staging` highest migration `0036`.
- `testMode` enabled for mock execution (embedded Postgres under FUSION_HOME).

## Focused successful tasks (mock / testMode)

Disposable repos (no remotes):

- `/srv/appsolino-fusion/staging/disposables/v1a2-repo-a` @ `562dcc056edd7833467855611c80b9a989ea02e3`
- `/srv/appsolino-fusion/staging/disposables/v1a2-repo-b` @ `562dcc056edd7833467855611c80b9a989ea02e3`

Projects: `proj_57da27e6a4ea47f3` (VA2), `proj_58ee53e365b345f6` (VB2).

| Scenario | Task ID | Terminal | Worktree (during run) | Attempts | Notes |
| --- | --- | --- | --- | --- | --- |
| A read | VA2-001 | done | crisp-wren | 1 | no Step-out-of-range; no redispatch |
| B write | VA2-002 | done | lemon-badger | 1 | lifecycle PASS; mock did not materialize `v1a2-created.txt` (no-op merge) |
| C modify | VA2-003 | done | keen-lotus | 1 | lifecycle PASS; `notes.txt` unchanged on disk (mock no-op) |

Blocking V1A.1 defects absent: zero `Step N out of range`; no todo↔in-progress storm; single worktree per task.

## Concurrency

| Task | Project | Terminal | Branch |
| --- | --- | --- | --- |
| VA2-004 | repo-a | done | fusion/va2-004 |
| VB2-001 | repo-b | done | fusion/vb2-001 |

Distinct task IDs, branches, and worktrees (`lemon-frost`, `quiet-lark`). Service remained healthy. No cross-repo contamination observed.

## Deterministic-failure parking

- Live mock path no longer emits the old out-of-range execute failure (Correction B).
- Automated evidence on corrected source: `mock-provider`, `transient-error-detector`, `executor-graph-requeue-gate` — **122 tests passed**; `executor-tool-failure-retry` — **9 tests passed** (established tool-failure retry path retained).
- Artificial on-disk status injection did not stick through the live TaskStore (task continued and completed); not treated as a product park proof.
- Scheduler observation: successful tasks remain single-attempt; no redispatch loops in the mission log window (`out_of_range=0`).

## Restart persistence

- Pre-restart: VA2-001…005 and VB2-001 all `done`.
- Restart: health `ok` quickly; runtime helpers still executable; no EACCES.
- Post-restart: all prior tasks still `done`; no new worktrees for old tasks; no redispatch.
- Post-restart smoke VA2-006 → `done` once.

## Resource / log summary

| | Approx |
| --- | --- |
| Mem available after | ~3.7 Gi |
| Swap used | ~2.3 Gi |
| Disk `/` | 21% |
| Failed systemd units | none |
| Listener | `127.0.0.1:4140` |
| Duplicate executions | NONE |
| Contamination | NONE |

Log observations: `EPERM` chmod on immutable helpers (non-blocking); no `Step N out of range`; no runtime EACCES; no prolonged starting/holding after Correction A install.

## Final decision

**PASS WITH OBSERVATIONS**

Blocking Correction A/B behaviours fixed on Host D staging with corrected candidate `v1a2-0.74.0-beta.5-3bc46bffe`. Observations: built-in mock executor completes lifecycle without applying descriptive file writes; immutable-release `chmod` EPERM noise during embedded init.

## Explicit statements

- HOST_P_ACCESSED: NO
- PRODUCTION_IDENTITIES_ON_HOST_D: ABSENT
- LEGACY_PRODUCTION_TOUCHED: NO
- OLD_CANDIDATE_MUTATED: NO
- V1B_STARTED: NO

---

# V1A.3 — Host D real-provider execution proof

Last updated: 2026-07-30

result: **BLOCKED**

date (UTC): 2026-07-30
hostname: `vmi3201923` (Host D)

## Candidate (unchanged — no rebuild)

- release ID: `v1a2-0.74.0-beta.5-3bc46bffe`
- executable SHA-256: `4d58e8a1205a0334e6506427bc588a2ac6e76f2aa01b852610b93dedee0d2829` (MATCH)
- staging path: `/opt/appsolino-fusion/staging/releases/v1a2-0.74.0-beta.5-3bc46bffe`
- `current` symlink: active → same release
- CANDIDATE_REBUILT: NO

## Preflight

| Check | Result |
| --- | --- |
| Primary `main` clean / ff to tip | YES (`3d0eefb69325706c921e819dce7bbbe45acd1374` after PR #15/#16) |
| Release active | YES |
| Exe SHA match | YES |
| Health | `ok` / `0.74.0-beta.5` |
| Listener | `127.0.0.1:4140` only |
| Engine before config inspection | PAUSED (`enginePaused=true`; service `--paused`; DB `isRunning=false`) |
| Old tasks eligible for redispatch | NONE (proj A: 6×`done`; proj B: 1×`done`) |

## Provider inventory (secrets redacted)

| Item | Observation |
| --- | --- |
| Global `testMode` | `true` (forces mock/scripted for all AI lanes) |
| `enginePaused` | `true` |
| Configured execution provider/model | Not runnable as real provider while `testMode=true`; no non-mock provider/model pair selected for live execution |
| Credential source | `/etc/appsolino-fusion/staging/secrets.env` keys: `DATABASE_URL`, `STAGING_DB_PASSWORD` only — **no AI provider keys** |
| Agent auth store | `FUSION_HOME/.fusion/agent/auth.json` = empty object `{}` |
| Automatic fallback enabled | `executorModelEscalationEnabled=false`; `customProviders=[]` |
| Actual runtime if task started under current settings | Would be **mock** (forbidden for V1A.3) |

**Gate:** Real provider cannot be run without silently using mock. Per mission rules → **BLOCKED** (did not create/run a task; did not disable `testMode` to fake a pass).

## Disposable repo prepared (no execution)

- Path: `/srv/appsolino-fusion/staging/disposables/v1a3-real-provider`
- Baseline commit: `0477dcde8ad7efe73883bbcb360b8db857761952`
- Files: `README.md`, `notes.txt`
- Remotes: none
- Owner: `fusion`
- Project registration / task creation: **NOT DONE** (blocked at provider gate)

## Execution evidence

| Field | Value |
| --- | --- |
| Task ID | N/A (not created) |
| Run ID | N/A |
| Selected vs actual provider/model | N/A — no real-provider session |
| Worktree / branch | N/A |
| Attempts | 0 |
| Terminal state | N/A |
| Git diff | N/A |
| Process evidence | N/A |
| Service restart after terminal | NOT REQUIRED (no run) |

## Blocking reason

Host D staging has **no real AI provider credentials** and `testMode=true`. V1A.1 already recorded that production AI credentials are absent on Host D. V1A.3 requires one real-provider execution with no testMode/mock; proceeding would violate the anti-mock rule or the no-Host-P / no-production-credentials constraint.

Operator unblock path (out of scope for this mission): provision a **non-production** real-provider credential into staging secret store, set `testMode=false`, keep engine paused until inspection, then re-run V1A.3 on the same candidate without rebuild.

## Related Host D ops (same mission window)

- PR #15 timing rule: MERGED (`d7b97d82f…`)
- PR #16 upstream shadow docs/YAML-in-docs: MERGED (`3d0eefb69…`)
- Workflow activation to `.github/workflows/upstream-shadow.yml`: **BLOCKED** — OAuth token scopes `gist,read:org,repo` lack `workflow`; `gh auth refresh -s workflow` device flow not completed; deploy keys disabled on Appsolino/Fusion; no PAT with workflow scope found. Local activation commit exists only on worktree `ops-upstream-shadow-monitor` (`42fdd6a62`) and was not pushed. `gh workflow run upstream-shadow.yml` → HTTP 404. `upstream-shadow` branch ABSENT. Appsolino `main` unchanged by any shadow job.
- `a.anas.bz`: homepage HTTP 200 with basic auth; unauth 401; plaintext credential file shredded after smoke; `/etc/nginx/.htpasswd-fusion-dev` preserved. Operator must store password in password manager (agent cannot access PM).

## Final decision

**BLOCKED**

No real-provider proof attempted. Candidate unchanged. No mock laundering.

## Explicit statements

- HOST_P_ACCESSED: NO
- PRODUCTION_IDENTITIES_ON_HOST_D: ABSENT
- LEGACY_PRODUCTION_TOUCHED: NO
- UPSTREAM_MERGED: NO
- V1B_STARTED: NO

# G1 / V1A.3 retest — 2026-07-31

result: **BLOCKED**

Pinned candidate: `v1a2-0.74.0-beta.5-3bc46bffe` / source `3bc46bffe5fd217206f2f993753445f645374431`

Evidence (redacted):

- Health `ok`; engine paused (`--paused` / `enginePaused=true`)
- `testMode=true` → `/api/models` resolves `mock` / `scripted`
- `auth.json` empty; `secrets.env` DB-only
- `executorModelEscalationEnabled=false`
- No task created; mock not used as proof

HOST_P_ACCESSED: NO
PRODUCTION_IDENTITIES_ON_HOST_D: ABSENT
LEGACY_PRODUCTION_TOUCHED: NO
UPSTREAM_MERGED: NO
V1B_STARTED: NO
