# Appsolino Fusion — known issues (active)

**Operational register** (not a governing authority document).
Search this file **before** diagnosing or fixing any defect.

Historical archive only: `docs/appsolino/master-plan/03-appsolino-known-issues-and-fixes.md` (Status: Historical/reference).

Live blockers / next action: `CURRENT-STATE.md` (links high-priority open items only).

---

## ISS-UI-001 — Settings search hijacked by browser autofill

Status: OPEN / REGRESSION
Severity: High
Component: Dashboard / Settings
First observed: Unknown historical occurrence — owner reports it happened previously
Last observed: 2026-07-31
Affected release: `v1a2-0.74.0-beta.5-3bc46bffe`
GitHub issue: https://github.com/Appsolino/Fusion/issues/23

### Failure fingerprint

- Search Settings is populated automatically with the browser account email.
- Clearing the field causes the email to return immediately.
- No settings sections remain visible.
- Authentication and model configuration become inaccessible.

### Impact

Blocks normal access to Settings and provider authentication.

### Temporary workaround

Use Chrome Guest or Edge InPrivate with extensions disabled.

### Root cause

UNRESOLVED — likely browser/password-manager classification of the search input as an identity field. Must be proven in source and browser testing.

### Permanent correction

- Correct input/form autocomplete semantics.
- Prevent browser and password-manager identity autofill.
- Preserve normal settings filtering.
- Validate Chrome and Edge saved-profile behavior.

### Required regression tests

- Search starts empty.
- Clear remains empty.
- Saved browser email is not injected.
- Typed filtering works.
- Reload does not restore an email.
- Authentication section remains accessible.

### Fix history

| Release/SHA | Result | Evidence |
| --- | --- | --- |
| Not fixed yet | — | — |

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

## G1 / V1A.3 — Real-provider credential for physical-edit proof

Status: OPEN / BLOCKED
Severity: High
Component: Host D staging provider auth
Affected release: `v1a2-0.74.0-beta.5-3bc46bffe`
GitHub issue: https://github.com/Appsolino/Fusion/issues/21

### Failure fingerprint

- No usable real-provider credential (or Settings unreachable without Guest/InPrivate).
- `testMode=true` forces `mock`/`scripted`.
- Physical repository edit proof cannot start safely.

### Temporary workaround

Enter Anthropic API key via Guest/InPrivate (ISS-UI-001 workaround), then clear `testMode` and run G1 once.

### Permanent correction

Complete G1 physical-edit proof; keep ISS-UI-001 permanent Settings fix before relying on AUTO-1 credential UX.
