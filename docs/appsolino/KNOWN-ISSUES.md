# Appsolino Fusion — known issues (active)

**Operational register** (not a governing authority document).
Search this file **before** diagnosing or fixing any defect.

Historical archive only: `docs/appsolino/master-plan/03-appsolino-known-issues-and-fixes.md` (Status: Historical/reference).

Live blockers / next action: `CURRENT-STATE.md` (links high-priority open items only).

---

## ISS-UI-001 — Settings non-identity fields hijacked by browser credential autofill

Status: OPEN / FAIL — incomplete autofill correction (expanded; pending Edge re-acceptance)
Severity: High
Component: Dashboard / Settings / Authentication
First observed: Unknown historical occurrence — owner reports it happened previously
Last observed: 2026-07-31 (normal Edge profile acceptance)
Affected release: `v1a2-0.74.0-beta.5-3bc46bffe` (search); `issui001-0.74.0-beta.5-d1e7cc423` (PARTIAL / FAILED EDGE ACCEPTANCE)
Candidate fix release: `issui001b-0.74.0-beta.5-6fd7443ee`
GitHub issue: https://github.com/Appsolino/Fusion/issues/23

### Failure fingerprint

- Settings search populated with the browser account email (original report).
- Cursor CLI binary path populated with the saved browser email (Edge evidence: `anas966@gmail.com` instead of `/home/fusion/.local/bin/cursor-agent`).
- API-key replacement / password input populated with a saved password (DeepSeek masked autofill on Edge).
- Clearing or reopening fields re-triggers autofill.
- Saving / Save & Test with injected values could overwrite valid application configuration (Cursor path or stored API keys). **Do not save while contaminated.**

### Impact

Blocks trustworthy Settings configuration; risk of overwriting Cursor CLI path and provider API keys.

### Temporary workaround

Use Chrome Guest or Edge InPrivate with extensions disabled for configuration changes. Close Settings without Save / Save & Test if fields show injected credentials.

### Root cause

Broader than the search box: Settings Authentication non-identity controls (search filter, CLI binary path text inputs, always-mounted `type=password` API-key fields) sit near credential UI and are classified by Edge/Chromium password managers as login username/password fields. Browser injection updates React controlled state and can enable Save & Test.

### Permanent correction

- Search: non-identity `settings-filter` + read-only-until-focus (first candidate).
- Cursor / Grok / OMP CLI binary paths: explicit non-identity id/name, autocomplete off, PM ignore attrs, read-only until focus; discard pre-focus change events so Save & Test cannot submit injected values.
- API keys: do not mount an editable password input for a stored key; show Key stored / Replace / Clear; mount replacement input only after Replace with `autocomplete=new-password` + lock-until-focus.
- Do not globally disable browser password management for genuine website logins.
- Validate on a normal Edge profile with saved credentials before marking FIXED. Chrome with no saved autofill identity is inconclusive.

### Required regression tests

- Search starts empty; clear remains empty; non-identity attrs (retained).
- Cursor path starts configured; DOM email injection before focus does not update state; Save & Test stays disabled without explicit edit.
- Stored API key has no editable password field until Replace; Replace opens empty input; injection before focus cannot modify state; non-login autocomplete attrs.
- Authentication / model sections remain reachable; explicit typing/saving still works.

### Fix history

| Release/SHA | Result | Evidence |
| --- | --- | --- |
| `issui001-0.74.0-beta.5-d1e7cc423` / `d1e7cc423` | PARTIAL / FAILED EDGE ACCEPTANCE | Search protected; Edge injected email into Cursor CLI binary path; DeepSeek password-like autofill; Chrome inconclusive (no saved autofill identity) |
| `issui001b-0.74.0-beta.5-6fd7443ee` / `6fd7443ee` | DEPLOYED — pending Edge re-acceptance | Path + API-key Replace UX; unit suites green; Host D health ok; cursor path still `/home/fusion/.local/bin/cursor-agent` |

---

## ISS-GIT-007 — Merge path assumes `main` instead of repository default branch

Status: OPEN
Severity: High (blocks AUTO-1 auto-merge reliability)
Component: Engine / task-merge / default-branch resolution
First observed: 2026-07-31 (G1 `KB-003` on disposable `v1a3-real-provider`)
Last observed: 2026-07-31
Affected release: `g13b-0.74.0-beta.5-cadf34dd4`
GitHub issue: (record only; fix before AUTO-1 — do not implement inside ISS-UI-001)

### Failure fingerprint

- Repository default branch is `master`.
- Auto-merge / merge expectation targets `main`.
- Auto-merge fails; physical edits already succeeded on the task branch.
- Recovery required manual fast-forward of the agent commit onto `master` (KB-003: `173793d`).

### Impact

G1 physical proof still PASSed (Cursor execution and edits succeeded), but automatic task merging cannot be trusted for AUTO-1 while the merge path ignores the repository default branch.

### Temporary workaround

Manual fast-forward / merge onto the repository default branch when auto-merge fails for this mismatch.

### Root cause

Merge path assumes `main` rather than resolving the repository’s actual default branch (observed `master` on the disposable proof repo). Recorded in PR #27 / CURRENT-STATE G1 merge note.

### Permanent correction

Resolve and merge into the repository default branch (or configured integration branch), not a hard-coded `main`. Add regression coverage for non-`main` defaults. **Do not fix inside ISS-UI-001.**

### Required regression tests

- Disposable / fixture repo whose default branch is `master` completes auto-merge onto `master`.
- Repo whose default is `main` is unchanged.
- Missing `main` with default `master` must not fail solely because `main` is absent.

### Fix history

| Release/SHA | Result | Evidence |
| --- | --- | --- |
| Not fixed yet | OPEN | KB-003 manual FF onto `master`; PR #27 |

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

Fix ISS-CLI-005 so `cursor-cli/<explicit-model>` is usable for planning/execution; then re-run G1 once. Keep ISS-UI-001 permanent Settings fix before AUTO-1.

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
