# Appsolino Fusion — known issues (active)

**Operational register** (not a governing authority document).
Search this file **before** diagnosing or fixing any defect.

Historical archive only: `docs/appsolino/master-plan/03-appsolino-known-issues-and-fixes.md` (Status: Historical/reference).

Live blockers / next action: `CURRENT-STATE.md` (links high-priority open items only).

---

## SOAK-R2-DEFECT-001 — Planning settlement livelock + lifecycle lock + worktree leak

Status: **FIXED** (pending Host D deploy of remediation PR)
Severity: Critical
Component: Engine triage / Cursor runtime / PostgreSQL lifecycle lock / Host D soak
First observed: 2026-08-08 (Host D Lights-Out Soak R2)
Evidence: `/srv/appsolino-fusion/staging/disposables/host-d-soak-evidence/soak-r2/`

### Failure fingerprints

- **001A:** `Planner runtime cursor did not provide a fallback-dispatch settlement boundary` → status restored to claimable todo → plan again (HOST2-001…010; 0 implementations)
- **001B:** `Planning lifecycle lock requires a direct PostgreSQL session endpoint` (self-healing stranded-hold reconciliation)
- **001C:** Pre-implementation worktrees reaped as leaked / remaining at stop (`merry-brook`, `gilt-lark`) while tasks in `todo`

### Root causes

1. Cursor runtime `createSession` omitted `settleFallbackDispatch`; triage fail-closed into bounded todo retries even when PROMPT.md was written.
2. External non-pooler `DATABASE_URL` did not populate `directSessionUrl` (only `DATABASE_MIGRATION_URL` did), so Host D's direct `127.0.0.1:5432` URL still left lifecycle locks unavailable.
3. Settlement/validation failure paths restored claimable todo without releasing the planning worktree.

### Permanent correction

- Cursor runtime returns an explicit no-op `settleFallbackDispatch` (same contract as DefaultPiRuntime).
- Backend resolver treats non-pooler `DATABASE_URL` as `external-direct` lifecycle-lock endpoint.
- Triage releases pre-execution worktrees on settlement/validation failure retry and park.
- Self-healing fail-closes with audited `planning-lifecycle-lock-unavailable` when the lock transport is missing.
- `/api/settings/scopes` exposes `effective.schedulerPausedForProject` for operator clarity.

### Required regression tests

- Cursor-like plugin settlement → single handoff (`triage.test.ts`)
- Missing settlement boundary → worktree release
- Backend resolver `external-direct` / pooler-null cases
- Advisory lock accepts `external-direct` provenance

---

## SOAK-DEFECT-001 — Missing Cursor runtime → planning retry storm + orphan worktrees

Status: **FIXED**
Severity: High
Component: Engine triage / Cursor runtime plugin / Host D soak
First observed: 2026-08-08 (Host D Lights-Out Soak #1)
Last observed fixed: 2026-08-08
Affected release (failure): `auto3-0.75.1-ac469cf355a1`
Fix release (Host D): `auto3-0.75.1-cb506f2095f4`
GitHub issue: https://github.com/Appsolino/Fusion/issues/160
GitHub PR: https://github.com/Appsolino/Fusion/pull/159

### Failure fingerprint

- Planning error text contains `Cursor CLI models require the bundled Cursor runtime plugin`
- `fusion-plugin-cursor-runtime` installed globally but **disabled for the soak project**
- Same task redispatched for planning **12+ times in ~1 minute** (status restored → requeue)
- Tasks return to `todo` while disk worktrees remain (Soak #1: `pale-plume` / `merry-thorn`)

### Impact

Lights-out soak cannot start real implementation; capacity consumed by orphan worktrees; no CI-repair or restart-recovery proof reached.

### Permanent correction

1. Project-enable `fusion-plugin-cursor-runtime`; verify `/api/models` surfaces selected `cursor-cli` model under service HOME.
2. Set **project-effective** soak settings (project overrides global): `maxConcurrent=1`, `mergeStrategy=pull-request`, lanes on `cursor-cli`, `enginePaused=true` until owner unpause.
3. Service-HOME GitHub auth (`gh` + `setup-git`) so private fixture `Appsolino/host-d-lights-out-soak` ls-remote/fetch/push works without a human shell after launch.
4. Platform [#159](https://github.com/Appsolino/Fusion/pull/159): classify missing Cursor runtime as **operator-actionable**; park planning `failed`; call `releasePreExecutionWorktree` so capacity is released (no redispatch storm).

### Required regression tests

- Missing Cursor runtime plugin → operator-actionable park + worktree release (`triage.test.ts`)
- Error text matches permanent/config patterns (`transient-error-detector.test.ts`)
- Gate suite green on #159

### Fix history

| Release/SHA | Result | Evidence |
| --- | --- | --- |
| Soak #1 / `ac469cf355a1` | OPEN | scoreboard + observe logs under soak evidence |
| #159 / `cb506f2095f4` on Host D | FIXED | AUTO-3 [31237160172](https://github.com/Appsolino/Fusion/actions/runs/31237160172); Soak R2 preflight paused |

---

## ISS-UI-001 — Settings non-identity fields hijacked by browser credential autofill

Status: **PARKED** (OPEN — not FIXED; do not merge PR #28)
Severity: High
Component: Dashboard / Settings
First observed: Unknown historical occurrence — owner reports it happened previously
Last observed: 2026-07-31 (Edge acceptance FAIL on path/API-key fields after search-only candidate)
Affected release (active Host D): restored to `g13b-0.74.0-beta.5-cadf34dd4` — UI candidates inactive
GitHub issue: https://github.com/Appsolino/Fusion/issues/23
GitHub PR: https://github.com/Appsolino/Fusion/pull/28 (**do not merge**)

### Owner park (2026-07-31)

Primary target restored to **AUTO-1**. Do not continue this defect until AUTO-1…AUTO-3 land. Host D is not on `issui001` / `issui001b`.

### Failure fingerprint

- Search Settings and/or non-identity fields (CLI binary path, API keys) receive browser credential autofill.
- Clearing can bounce the value back; Settings sections become hard to use.
- Edge profile reproduced path-field email injection after the first candidate.

### Impact

Blocks reliable Settings / provider authentication UX under saved browser profiles.

### Temporary workaround

Use Chrome Guest or Edge InPrivate with extensions disabled.

### Root cause

UNRESOLVED — incomplete after search-only + expanded autofill hardening candidates; not accepted as FIXED.

### Permanent correction

- Correct input/form autocomplete semantics across non-identity Settings fields.
- Prevent browser/password-manager credential autofill hijack.
- Preserve normal settings filtering and Replace UX for secrets.
- Validate Chrome and Edge saved-profile behavior.

### Required regression tests

- Search starts empty; clear remains empty; typed filtering works.
- CLI binary path / API-key surfaces reject credential autofill in Edge/Chrome profiles.
- Authentication section remains accessible.

### Fix history

| Release/SHA | Result | Evidence |
| --- | --- | --- |
| `issui001-0.74.0-beta.5-d1e7cc423` / PR #28 | FAIL (Edge) | Path field injected email |
| `issui001b-0.74.0-beta.5-6fd7443ee` | Candidate only — not accepted | Expanded hardening; Host D restored to g13b |
| Not FIXED | PARKED | Owner priority → AUTO-1 |

---

## ISS-WF-002 — Deterministic execute failure redispatches (mock step index)

Status: FIXED (retain regression coverage)
Severity: High
Component: Engine / executor / mock workflow steps
First observed: V1A.1 (2026-07-30)
Last observed fixed: V1A.2 candidate `v1a2-0.74.0-beta.5-3bc46bffe`
GitHub issue: (historical; see V1A-DEV-STABILITY / Correction B)

### Failure fingerprint

- Mock/executor step index out of range (e.g. step 4 with steps 0–3).
- Task fails then requeues todo/in-progress instead of one durable terminal park.
- Duplicate worktrees / run IDs under redispatch storm.

### Permanent correction

Correction B on V1A.2: zero-based mock steps; deterministic execute failures park; no redispatch loop. Retain contract tests.

### Fix history

| Release/SHA | Result | Evidence |
| --- | --- | --- |
| `v1a2-0.74.0-beta.5-3bc46bffe` | FIXED | V1A.2 PASS WITH OBSERVATIONS |

---

## ISS-ENV-003 — Immutable install strips runtime execute bits

Status: FIXED (retain regression coverage)
Severity: High
Component: Staging install / packaged runtime helpers
First observed: V1A.1 (2026-07-30)
Last observed fixed: V1A.2 (`v1a2-0.74.0-beta.5-3bc46bffe`)
GitHub issue: (historical; see V1A-DEV-STABILITY / Correction A)

### Failure fingerprint

- `initdb` / `postgres` / runtime native bins not executable after install.
- Health stuck starting / `EACCES` on posix_spawn after restart.

### Permanent correction

Correction A: preserve execute bits on packaged runtime binaries; immutable release remains non-writable. Retain install contract checks.

### Fix history

| Release/SHA | Result | Evidence |
| --- | --- | --- |
| `v1a2-0.74.0-beta.5-3bc46bffe` | FIXED | V1A.2 PASS WITH OBSERVATIONS |

---

## G1 / V1A.3 — Real-provider physical-edit proof (Cursor CLI)

Status: PASS (KB-003; ISS-CLI-005 FIXED)
Severity: High
Component: Host D staging / Cursor CLI runtime
Affected release: `v1a2-0.74.0-beta.5-3bc46bffe`
GitHub issue: https://github.com/Appsolino/Fusion/issues/21

### Failure fingerprint (superseded layers)

- ~~Cursor CLI not installed or not authenticated on Host D.~~ (ISS-CLI-004 FIXED)
- ~~Default provider not set to Cursor CLI / `cursor-cli`.~~ (configured for attempt)
- ~~`testMode=true` would force `mock`/`scripted`.~~ (`testMode=false` for attempt)
- Physical repository edit proof still incomplete: planning hard-fails before edits (ISS-CLI-005).

### Owner provider decisions (2026-07-31)

- **Cursor CLI** selected as G1 and ongoing default provider.
- **DeepSeek** credential present (stored) but **runtime unverified** — not selected for G1; test separately after G1.
- **Anthropic** not required for G1.
- **No fallback** permitted during G1.

### G1 single-attempt evidence (2026-07-31)

- Task `KB-001` on disposable `v1a3-real-provider`; column `triage` / status `failed`.
- Configured: `cursor-cli` / `composer-2.5` (default + planning + execution lanes); `fallbackProvider` unset; `testMode=false`.
- Error: `Configured model cursor-cli/composer-2.5 (primary selection) was not found in the pi model registry`.
- No `provider-proof.txt`; `notes.txt` and `README.md` unchanged; no second attempt; engine paused after terminal; restart while paused showed no redispatch of a successful edit.

### Temporary workaround

None for G1 PASS on this pinned release until ISS-CLI-005 is fixed. Do not retry a second physical-edit task under the same broken registry path.

### Permanent correction

ISS-CLI-005 FIXED; G1 `KB-003` PASS on `g13b`. ISS-UI-001 is **parked** — do not block AUTO-1 on Settings autofill.

---

## ISS-CLI-004 — Cursor CLI auth HOME mismatch under fusion-staging

Status: FIXED
Severity: High
Component: Host D staging / Cursor CLI / systemd HOME
First observed: 2026-07-31 (G1.2a)
Last observed fixed: 2026-07-31 (owner Cursor login under service HOME)
Affected release: `v1a2-0.74.0-beta.5-3bc46bffe`
GitHub issue: https://github.com/Appsolino/Fusion/issues/21

### Failure fingerprint

- Authentication UI shows Cursor CLI Connected/Active (`useCursorCli=true`).
- Default Model picker shows only DeepSeek (or other API-key) models; no `cursor-cli` rows.
- `/api/providers/cursor-cli/status` reports `authenticated=false` while binary is available.
- Interactive `cursor-agent status` is logged-in under `/home/fusion`, but not under staging service `HOME`.

### Impact

G1 cannot pin `configured provider = actual provider = cursor-cli`. “Use default” does not route to Cursor CLI.

### Temporary workaround

Authenticate `cursor-agent` under `HOME=/srv/appsolino-fusion/staging/state/fusion-home` (service HOME), or otherwise align Cursor credential location with the service environment. Then set explicit `defaultProvider=cursor-cli` + `defaultModelId`. Do not use DeepSeek for G1.

### Root cause

`fusion-staging.service` sets `HOME`/`FUSION_HOME` to the staging fusion-home tree; Cursor CLI login state lives under the interactive user home. Model discovery spawned by the dashboard inherits the service HOME and sees an unauthenticated CLI.

### Permanent correction

Document and automate Host D Cursor CLI auth under the service HOME (or a deliberate shared credential path). Ensure `/api/models` surfaces `cursor-cli` rows before G1. Add regression coverage for service-HOME vs interactive-HOME auth mismatch.

### Required regression tests

- With `useCursorCli=true` and CLI auth under service HOME, `/api/models` includes `provider=cursor-cli`.
- With CLI auth only under a different HOME, status reports unauthenticated and Cursor rows are absent.
- Selecting `cursor-cli/<id>` sets resolved planning/execution away from DeepSeek and mock when `testMode=false`.

### Fix history

| Release/SHA | Result | Evidence |
| --- | --- | --- |
| G1.2a | OPEN | Service HOME unauthenticated; `/api/models` DeepSeek-only |
| `v1a2-0.74.0-beta.5-3bc46bffe` (2026-07-31) | FIXED | Owner login under service HOME; `/api/providers/cursor-cli/status` `binary.authenticated=true` / `ready=true`; `/api/models` returns many `provider=cursor-cli` rows (incl. `composer-2.5`) |

---

## ISS-CLI-005 — cursor-cli models in `/api/models` but absent from pi model registry

Status: FIXED
Severity: High
Component: Engine planning / pi model registry / cursor-cli plugin path
First observed: 2026-07-31 (G1 physical-edit attempt `KB-001`)
Last observed: 2026-07-31
Affected release: `v1a2-0.74.0-beta.5-3bc46bffe`
GitHub issue: https://github.com/Appsolino/Fusion/issues/21

### Failure fingerprint

- Phase 1/2 preflight PASS: service-HOME Cursor auth OK; `/api/models` lists `cursor-cli` (193+ rows); settings pin `cursor-cli`/`composer-2.5`; `fallbackProvider` unset; `testMode=false`.
- Exactly one task (`KB-001`) fails at planning with: `Configured model cursor-cli/composer-2.5 (primary selection) was not found in the pi model registry`.
- No runtime-resolved session provider/model; no physical edits; DeepSeek/fallback/mock not used.

### Impact

G1 cannot prove `configured provider = actual provider = cursor-cli` on this pinned candidate. Catalog discovery and session creation disagree.

### Temporary workaround

None accepted for G1 (no second attempt; no DeepSeek; no fallback; no mock PASS).

### Root cause

UNRESOLVED — dashboard model catalog merges Cursor CLI models for `/api/models`, but `resolveConfiguredModel` in the engine pi path hard-fails when the pi `ModelRegistry` has zero models for provider `cursor-cli` (same class of failure previously seen for other CLI providers before registry wiring).

### Permanent correction

Register Cursor CLI models into the pi model registry used by planning/execution session creation (or route cursor-cli through the plugin runtime path that already succeeds for discovery), so an explicit `cursor-cli/<id>` from `/api/models` is accepted. Add a regression that selects a catalogued `cursor-cli` model and asserts session creation does not throw the pi-registry hard-fail.

### Required regression tests

- With Cursor CLI authenticated and `useCursorCli=true`, a model present in `/api/models` with `provider=cursor-cli` must resolve in planning session creation.
- Hard-fail message must not appear for that pair when auth and toggle are healthy.
- DeepSeek must remain unused when `defaultProvider=cursor-cli` and fallback is unset.

### Fix history

| Release/SHA | Result | Evidence |
| --- | --- | --- |
| `v1a2-0.74.0-beta.5-3bc46bffe` | OPEN | G1 `KB-001` journal + task.error (2026-07-31) |
| `g13b-0.74.0-beta.5-cadf34dd4` / PR #26 + eager-install follow-up | FIXED | Route `cursor-cli`→`cursor` runtime; print-mode adapter; eager host install; stage `dist/plugins`; G1 `KB-003` PASS |

---

## ISS-GIT-007 — Auto-merge / integration assumes `main` when default branch differs

Status: OPEN (design incorporated in AUTO-1 branch resolution; engine task-merge fix still required before AUTO-3 trust)
Severity: High
Component: Engine merge / git default-branch resolution
First observed: 2026-07-31 (G1 `KB-003` disposable repo)
Last observed: 2026-07-31
GitHub: (track via CURRENT-STATE; no separate issue required for AUTO-1)

### Failure fingerprint

- Disposable proof repo default branch was `master`.
- Auto-merge / integration logic looked for `main` and blocked or mis-targeted.
- Manual fast-forward recovered G1 evidence; automation must not assume `main`.

### Impact

Blocks trustworthy AUTO-3 auto-merge and can mis-target integration PRs if default ≠ `main`.

### Permanent correction

- Resolve the repository's actual default/integration branch (`origin/HEAD` / API default_branch) everywhere merge/PR base is chosen.
- AUTO-1: `resolveIntegrationBranch()` in `infra/scripts/auto1-upstream-sync.mjs` (override + `origin/HEAD`).
- Remaining: engine task-merge / auto-merge paths before AUTO-3.

### Fix history

| Surface | Result | Evidence |
| --- | --- | --- |
| G1 `KB-003` | OPEN (manual FF) | Missing `main` while default was `master` |
| AUTO-1 script | Partial (design) | Non-`main` harness test + `origin/HEAD` resolution |

---

## ISS-AUTO-003 — AUTO-2 waiter selects unrelated older AUTO-3 run

Status: **FIXED** (live proven on Host D via PR #52)
Severity: High
Component: AUTO-2 finalize / approve-sensitive → AUTO-3 dispatch waiter
First observed: 2026-08-01 (AUTO-4 PR #47 approve-sensitive parent)
Last observed fixed: 2026-08-01 (proof PR #52 / AUTO-3 run 30691437372)
GitHub: parent [run 30691423651](https://github.com/Appsolino/Fusion/actions/runs/30691423651); child [run 30691437372](https://github.com/Appsolino/Fusion/actions/runs/30691437372) DEPLOYED

### Failure fingerprint

- After merge, `dispatchAndAwaitAuto3` listed AUTO-3 runs with jq `select(.head_sha==… or .display_title!=null)` and fell back to newest run.
- Newly dispatched child not yet visible → waiter attached to older **failed** completed run (e.g. `30679116104`).
- Parent reported FAILED / exit 2 while the real child later **DEPLOYED** Host D correctly.

### Impact

False-negative parent workflow results; operators cannot trust AUTO-2 success/failure after merge+deploy; risk of unnecessary retries or missed terminals.

### Permanent correction

- Unique `handoff_id` per dispatch; AUTO-3 `run-name` embeds handoff + source SHA + PR + profile.
- Poll only matching `workflow_dispatch` runs created after dispatch; then stick to that run id.
- Emit `AUTO3_TERMINAL_STATUS=…`; map DEPLOYED / IDEMPOTENT_NOOP / ROLLED_BACK / FAILED / CRITICAL / BLOCKED.
- Parent exit 0 only for DEPLOYED / IDEMPOTENT_NOOP; durable nonzero otherwise; no continuous retry.

### Required regression tests

- `infra/scripts/__tests__/auto3-handoff.test.mjs` (legacy race proof + correlated selection + terminals + static workflow guards).

### Fix history

| Surface | Result | Evidence |
| --- | --- | --- |
| AUTO-4 #47 parent waiter | FAIL (false) | Attached `30679116104` while child `30687790065` DEPLOYED |
| `auto3-handoff.mjs` + waiter rewrite (#51) | FIXED | Unit/integration tests green |
| Live proof PR #52 | PROVEN | Handoff `auto2-30691423651-1-5f1b923bd815-5ccedbe0` → child `30691437372` DEPLOYED; older failed ignored |
| Finalize YAML heredoc (#53) | FIXED | Restored `workflow_dispatch` registration |
| Finalize summary exit (#54 follow-up) | FIXED | Parent no longer fails after successful DEPLOYED due to summary SyntaxError |

---

## FIX-FALSE-SUCCESS-PUSH — pushAfterMerge failure still marked done

Status: **IN FIX** (PR #124)
Severity: Critical
Component: Engine / merger
First observed: 2026-08-07 (expert Part B review)
GitHub PR: https://github.com/Appsolino/Fusion/pull/124
Patch registry: `FIX-FALSE-SUCCESS-PUSH`

### Failure fingerprint

- `pushAfterMerge: true`, local merge succeeds, remote push fails.
- Task moves to `done` with only `pushedToRemote: false` / task-log evidence.

### Impact

False SUCCESS / DONE when a configured mandatory push final failed.

### Permanent correction

Refuse `done` on push failure/abort; park `failed` with `PUSH_FAILED: …`. Local land not rolled back.

---

## FIX-VERIFICATION-PASSED-EVIDENCE — verificationPassed from config presence

Status: **IN FIX** (PR #124)
Severity: High
Component: Engine / merger post-merge audit
First observed: 2026-08-07 (expert Part B review)
GitHub PR: https://github.com/Appsolino/Fusion/pull/124
Patch registry: `FIX-VERIFICATION-PASSED-EVIDENCE`

### Failure fingerprint

- Rebase merge path set `verificationPassed = Boolean(testCommand || buildCommand)` instead of returning an execution result from the verifier runner.

### Permanent correction

`applyBranchCommitsPreservingHistory` returns `verificationPassed` only after successful `runDeterministicVerification`.

---

## ISS-UP-LATENCY-001 — Blind long waits in autonomous upstream maintenance

Status: **MOSTLY FIXED** (architecture + #144 absorb complete; residual: Cursor Approval Agent overlap, RELEASE_STALE plane)
Severity: High (operational reliability)
Component: Upstream AUTO-2 expert / sensitive path / self-hosted runner
First observed: 2026-08-07 (runs `31169133069`, `31171067130`, candidate #135)
Evidence: `docs/appsolino/upstream/MAINTENANCE-LATENCY-AUDIT.md`

### Failure fingerprint

- Cursor/operator sees tens of minutes “waiting for the expert” without phase attribution.
- SENSITIVE + deterministic AUTO-2 SUCCESS still opens an **edit-capable** resolver (UNNECESSARY_EXPERT_INVOCATION).
- Per-child 15m timeouts multiply across repair×verifier attempts.
- Freshness checked only at loop boundaries → STALE_WORK after long AI calls.
- Runner queue conflated with AI time.
- SENSITIVE_REVIEW package sent `migrationInfo:null` / `patchRegistryChanges:[]` while the candidate declared migrations and registry churn → verifier REQUEST_CHANGES → Composer repair burned the full 20m cycle budget (runs `31205033983`, exit 143) without a code defect.

### Permanent correction (in progress)

- `SENSITIVE_REVIEW` (read-only verifier) vs `REPAIR_REQUIRED` (edit agent).
- Total cycle wall-clock budget (`LATENCY_BUDGET_EXHAUSTED`); phase budgets; mid-flight stale watchdog.
- Latency evidence artifact + heartbeat; `pnpm appsolino:maintenance-latency-report`.
- Targeted REQUEST_CHANGES + NON_CONVERGING_LOOP; cancel superseded expert runs.
- Orchestrator-built `sensitive-review-package.mjs` declares migrations + patch registry delta before the read-only verifier runs.
- AI verifier APPROVE / `auto2:ai-verified` merge without Anas966 (#150/#151).

### Do not

Weaken deterministic validation or fail-closed trust to “go faster.”
Send Composer repair solely to invent review-package metadata the orchestrator already knows.

---

## ISS-UP-GOV-001 — External Cursor Approval Agent overlaps upstream controller

Status: **DISABLED_BY_OWNER** (verification pending on next `automation/upstream-*` PR)
Severity: Medium (duplicate reviews / Anas966 re-requests; not merge authority)
Component: Cursor Automation `83ebd12a-8fb8-11f1-a7d1-d6b4613131ce` + AUTO-2
First observed: 2026-08-07 on PR #144
Evidence: PR reviews “Sent by Cursor Approval Agent…”; `docs/appsolino/upstream/CURSOR-APPROVAL-AGENT-EXCLUDE.md`

### Failure fingerprint

- Every `pull_request synchronize` on `automation/upstream-*` gets a `cursor[bot]` COMMENTED review (“not approving”) and re-requests `Anas966`.
- Visually confusable with `appsolino-fusion-automation[bot]` Sensitive review APPROVE (intended).
- Steward Dual Approve (`steward-cursor-dual-approve.yml`) is unrelated — `workflow_dispatch` only.

### Permanent correction

- Owner disabled Cursor Automation `83ebd12a-…` (2026-08-07).
- On next machine-managed PR: verify no `cursor[bot]` review / Anas966 request → close this issue.
- Repo-side defensive reviewer cleanup remains until that verification.
- Maintenance controller remains sole authority for validation / AI review / repair / finalize.

### Do not

Treat `cursor[bot]` comments as AUTO-2 verifier APPROVE.
Restore Anas966 as the normal upstream merge gate.
Block #153 waiting on live verification — repo-side path is already safe.

---

## ISS-UP-REL-001 — Source current while GitHub Latest Release stale

Status: **OPEN** (tracking plane; publish policy deferred)
Severity: Low–Medium (operator confusion, not runtime rollback)
Component: Release workflow / tag plane vs AUTO-1 absorb
First observed: 2026-08-07 (source `0.75.1`, Latest Release `v0.73.0`)
Evidence: `infra/scripts/upstream/release-freshness.mjs`

### Failure fingerprint

- Appsolino `package.json` / source at upstream version while GitHub Releases page shows older `v*`.
- No `v*` tag pushed on absorb → release workflow never fires.

### Permanent correction

- Track `RELEASE_STALE` / `RELEASE_PENDING` / `RELEASE_CURRENT` separately from source FRESH.
- Publish Appsolino release when upstream **VERSION** changes + release-level validation — not on every absorb commit.

### Do not

Infer product rollback from the Latest Release badge alone.
Auto-publish ten GitHub releases for ten upstream commits at the same version.
