# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-07-31T10:36:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `cadf34dd4` (+ follow-up PR for eager Cursor install / plugins staging) |
| Active Host D release | `g13b-0.74.0-beta.5-cadf34dd4` |
| Executable SHA-256 | `3b0f701b7e3fe3c7b5441f784dadb659d439378cc7d858a5bc743463e9cea82a` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Staging result | **G1 PASS** (ISS-CLI-005 corrected; task `KB-003`; Cursor CLI physical edits validated) |
| Host P state | Deferred |
| Legacy production | DEGRADED / FROZEN |

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| DeepSeek | Stored; **not used for G1** |
| Fallback during G1 | unset / unused |
| `testMode` | `false` |

## G1 result (2026-07-31)

| Item | Value |
| --- | --- |
| Task ID | `KB-003` (do not retry `KB-001`) |
| Configured | `cursor-cli` / `composer-2.5` |
| Actual runtime | `cursor` plugin runtime (`Using runtime "cursor"`) |
| DeepSeek / fallback / mock | NO |
| Edits | `provider-proof.txt` exact; `notes.txt` line once; README unchanged |
| Merge note | Auto-merge blocked on missing `main` while repo default is `master`; agent commit `173793d` fast-forwarded onto `master` for physical proof |

## Current blockers

1. **ISS-UI-001** — Settings search autofill. Permanent fix before AUTO-1. Issue #23.
2. **AUTO-1…AUTO-3** — not implemented.

## Milestone board

```text
G0: COMPLETE
ISS-CLI-004: FIXED
ISS-CLI-005: FIXED (routing + Cursor print-mode + eager install/plugins staging)
G1 physical-edit: PASS (KB-003)
AUTO-1…AUTO-4: NOT STARTED
```

## Next authorised mission

Permanent **ISS-UI-001** Settings autofill fix. Do not start AUTO-1 until that lands.
