# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-07-31T08:46:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `308a733da` (includes merged PR #24) |
| Active Host D release | `v1a2-0.74.0-beta.5-3bc46bffe` |
| Executable SHA-256 | `4d58e8a1205a0334e6506427bc588a2ac6e76f2aa01b852610b93dedee0d2829` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Staging result | V1A.2 PASS WITH OBSERVATIONS; **ISS-CLI-004 FIXED**; **G1 physical-edit FAIL** (ISS-CLI-005) |
| Host P state | Deferred |
| Legacy production | DEGRADED / FROZEN |

## Provider posture (owner decision)

| Item | Status |
| --- | --- |
| Default AI provider (required) | **Cursor CLI** (`cursor-cli` / `composer-2.5` configured) |
| DeepSeek API key | Stored/Active; **not used for G1**; runtime unproven for G1 |
| Anthropic | Not required for G1 |
| Fallback during G1 | Forbidden (`fallbackProvider` unset) |
| `testMode` after G1 attempt | `false` (engine remains paused) |

## G1 attempt (2026-07-31) — single shot

| Item | Value |
| --- | --- |
| Task ID | `KB-001` |
| Execution / run ID | none (failed at planning before session) |
| Configured provider/model | `cursor-cli` / `composer-2.5` |
| Runtime-resolved provider/model | **none** (hard-fail before session) |
| DeepSeek used | NO |
| Fallback used | NO |
| mock/scripted used | NO |
| Terminal error | `Configured model cursor-cli/composer-2.5 (primary selection) was not found in the pi model registry` |
| Physical edits | none (`provider-proof.txt` absent; `notes.txt` / `README.md` unchanged) |
| Attempts | exactly one (no retry) |

## Current blockers

1. **ISS-CLI-005** — `/api/models` lists `cursor-cli` rows after service-HOME auth, but planning session creation rejects `cursor-cli/<id>` as absent from the **pi model registry**. Blocks G1 physical-edit proof. Issue #21.
2. **ISS-UI-001** — Settings search autofill. Workaround: Guest/InPrivate. Issue #23. Permanent fix after G1 / before AUTO-1.
3. **AUTO-1…AUTO-3** — not implemented.

## Open high-priority issues

| Issue | Topic | Status |
| --- | --- | --- |
| https://github.com/Appsolino/Fusion/issues/21 | G1 FAIL / ISS-CLI-005 cursor-cli not in pi registry | OPEN / FAIL |
| https://github.com/Appsolino/Fusion/issues/23 | ISS-UI-001 Settings autofill | OPEN / REGRESSION |

## Milestone board

```text
G0: COMPLETE
G1.1: PASS (historical)
G1.2a Cursor HOME auth preflight: PASS (ISS-CLI-004 FIXED)
G1 physical-edit: FAIL (ISS-CLI-005; one attempt KB-001; no edits)
AUTO-1…AUTO-4: NOT STARTED
V1B: DEFERRED
```

## Next authorised mission

Product/fix for **ISS-CLI-005** so configured `cursor-cli/<explicit-model>` resolves in the pi model registry (or equivalent planning runtime path) on pinned `3bc46bffe…`. Do **not** create a second G1 task attempt until that is fixed and re-validated. Do not start ISS-UI-001 permanent fix or AUTO-1 yet.
