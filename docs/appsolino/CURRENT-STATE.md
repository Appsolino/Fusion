# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-07-31T12:45:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `8c5de412a` |
| Active Host D release | `g13b-0.74.0-beta.5-cadf34dd4` (restored; proven G1) |
| Executable SHA-256 | `3b0f701b7e3fe3c7b5441f784dadb659d439378cc7d858a5bc743463e9cea82a` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Staging result | **G1 PASS** retained on `g13b`. Unmerged ISS-UI-001 candidates preserved beside it (`issui001`, `issui001b`) — not active. |
| Host P state | Deferred |
| Legacy production | DEGRADED / FROZEN |

## Owner priority (2026-07-31)

```text
NOW:     AUTO-1 automated upstream integration
NEXT:    AUTO-2
THEN:    AUTO-3
BACKLOG: AUTO-4 catch-up
PARKED:  ISS-UI-001 / PR #28 (do not merge; do not continue until AUTO-1…AUTO-3 land)
NOTE:    ISS-GIT-007 must inform branch-resolution design in AUTO-1 (do not assume main)
```

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
| Merge note | Auto-merge blocked on missing `main` while disposable default was `master` → **ISS-GIT-007** |

## Current blockers

1. **AUTO-1 land + App secrets** — workflow/script on feature branch; fails closed until `APPSOLINO_AUTOMATION_APP_ID` / `APPSOLINO_AUTOMATION_APP_PRIVATE_KEY` are installed; do not absorb backlog onto production main until first green AUTO-1 validation.
2. **ISS-GIT-007** — AUTO-1 resolves `origin/HEAD`; engine task-merge fix still required before AUTO-3 auto-merge trust.
3. **ISS-UI-001** — PARKED (PR #28 open; not FIXED). Do not merge while AUTO sequence is active.
4. **AUTO-2…AUTO-4** — not started.

## Milestone board

```text
G0: COMPLETE
ISS-CLI-004: FIXED
ISS-CLI-005: FIXED
G1 physical-edit: PASS (KB-003) on g13b
AUTO-1: IMPLEMENTED (pending merge + GitHub App secrets; harness PASS)
AUTO-2…AUTO-4: NOT STARTED
ISS-UI-001: PARKED (PR #28)
```

## Next authorised mission

Land AUTO-1 PR → wire Appsolino Automation GitHub App secrets → validate workflow on a disposable/safe run → then AUTO-2. No Host D deploy in AUTO-1. No merge of PR #28.
