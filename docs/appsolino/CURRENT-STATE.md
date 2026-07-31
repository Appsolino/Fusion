# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-07-31T13:25:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `5f5598e8a` (PR #29 merged — AUTO-1 source on main) |
| Active Host D release | `g13b-0.74.0-beta.5-cadf34dd4` |
| Executable SHA-256 | `3b0f701b7e3fe3c7b5441f784dadb659d439378cc7d858a5bc743463e9cea82a` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Staging result | **G1 PASS** retained on `g13b`. ISS-UI candidates preserved inactive. |
| Host P state | Deferred |
| Legacy production | DEGRADED / FROZEN |

## Owner priority (2026-07-31)

```text
NOW:     AUTO-1 live activation (BLOCKED — App secrets missing)
NEXT:    AUTO-2 (only after AUTO-1 OPERATIONAL)
THEN:    AUTO-3
BACKLOG: AUTO-4 catch-up
PARKED:  ISS-UI-001 / PR #28 (do not merge)
NOTE:    ISS-GIT-007 remains open for engine merge paths; AUTO-1 resolves origin/HEAD
```

## AUTO-1 live proof (2026-07-31)

| Item | Value |
| --- | --- |
| Source / harness | **PASS** (merged via PR #29) |
| Live workflow proof | **BLOCKED** |
| Secret `APPSOLINO_AUTOMATION_APP_ID` | **ABSENT** (repo actions secrets total_count=0) |
| Secret `APPSOLINO_AUTOMATION_APP_PRIVATE_KEY` | **ABSENT** |
| Appsolino Automation GitHub App install | **NOT FOUND** among org installations |
| Run 1 | [30633998306](https://github.com/Appsolino/Fusion/actions/runs/30633998306) — fail-closed at credential gate |
| Run 2 | [30634031885](https://github.com/Appsolino/Fusion/actions/runs/30634031885) — same fail-closed (idempotent no-op beyond gate) |
| Automation PR | none created |
| Appsolino `main` during proof | unchanged at `5f5598e8a` (merge of #29 pre-dispatch) |
| Host D during proof | unchanged `g13b-0.74.0-beta.5-cadf34dd4` |
| Owner PAT / interactive `GH_CONFIG_DIR` in job | not used (gate failed before App token / sync) |

**OPERATIONAL criteria not met.** Do not start AUTO-2 until both live runs succeed with App identity.

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| DeepSeek | Stored; **not used for G1** |
| Fallback during G1 | unset / unused |
| `testMode` | `false` |

## Current blockers

1. **AUTO-1 live** — create/install Appsolino Automation GitHub App; set repo secrets `APPSOLINO_AUTOMATION_APP_ID` + `APPSOLINO_AUTOMATION_APP_PRIVATE_KEY`; re-run two `workflow_dispatch` proofs.
2. **ISS-GIT-007** — engine task-merge default-branch fix still required before AUTO-3 auto-merge trust.
3. **ISS-UI-001** — PARKED (PR #28 open; not FIXED).
4. **AUTO-2…AUTO-4** — not started (AUTO-2 waits on OPERATIONAL AUTO-1).

## Milestone board

```text
G0: COMPLETE
ISS-CLI-004: FIXED
ISS-CLI-005: FIXED
G1 physical-edit: PASS (KB-003) on g13b
AUTO-1 source: MERGED (PR #29)
AUTO-1 live: BLOCKED (App secrets / App install missing)
AUTO-2…AUTO-4: NOT STARTED
ISS-UI-001: PARKED (PR #28)
```

## Next authorised mission

Install Appsolino Automation GitHub App + wire the two secrets → two green `upstream-auto1.yml` dispatches → then mark AUTO-1 OPERATIONAL and start AUTO-2. Do not merge upstream absorb PRs onto Appsolino main as part of AUTO-1. No Host D deploy in AUTO-1. No merge of PR #28.
