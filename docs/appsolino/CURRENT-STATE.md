# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-01T07:00:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `3e6a0ad67262152fc846cc0134a424903f0b4dec` (PR #47 AUTO-4 absorb) |
| Active Host D release | `auto3-0.74.0-beta.5-3e6a0ad67262` |
| Source SHA | `3e6a0ad67262152fc846cc0134a424903f0b4dec` |
| Previous rollback release | `auto3-0.74.0-beta.5-a1b78a197860` |
| Schema ceiling | **0038** (`0038_mission_task_prefix.sql`) |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Host P state | Deferred / untouched (**accessed=NO**) |
| Legacy production | DEGRADED / FROZEN |
| Operating mode | **CONTINUOUS UPSTREAM MAINTENANCE** |

## Owner priority (2026-08-01)

```text
NOW:     Merge AUTO-3 handoff-correlation result PR → live disposable AUTO-2/AUTO-3 proof
         → post-catch-up AUTO-1 (upstream ahead ~15 commits of pin)
DONE:    AUTO-4 COMPLETE (pin 71576d953626; merge 3e6a0ad67262; Host D DEPLOYED)
PARKED:  ISS-UI-001 / PR #28 — do not start until this closure result PR lands
PARKED:  ISS-GIT-007 — do not start until closure completes
NOTE:    Do not re-run or re-merge PR #47. Engine stays paused. Host P untouched.
```

## AUTO-4 — COMPLETE

| Item | Value |
| --- | --- |
| Pinned upstream | `71576d9536267a7835f352922a55831811717896` |
| Absorb PR | #47 (merged; do not re-merge) |
| Merge SHA | `3e6a0ad67262152fc846cc0134a424903f0b4dec` |
| AUTO-3 child | [run 30687790065](https://github.com/Appsolino/Fusion/actions/runs/30687790065) → **DEPLOYED** |
| Active release | `auto3-0.74.0-beta.5-3e6a0ad67262` |
| Previous release | `auto3-0.74.0-beta.5-a1b78a197860` |
| Parent approve-sensitive | [run 30687772141](https://github.com/Appsolino/Fusion/actions/runs/30687772141) exited **2** (false FAILED — waiter race; real child DEPLOYED) |

## AUTO-3 handoff correlation (this mission)

| Item | Value |
| --- | --- |
| Incident | ISS-AUTO-003 — AUTO-2 waiter attached to older failed AUTO-3 run |
| Fix | Unique `handoff_id` in AUTO-3 `run-name`; poll only exact match; no newest-run / `display_title` fallback |
| Tests | `infra/scripts/__tests__/auto3-handoff.test.mjs` |
| Live proof | Pending merge of this correction to main, then disposable low-risk AUTO-2→AUTO-3 |
| Host P accessed | **NO** |

## AUTO-1 / AUTO-2 / AUTO-3

| Lane | Status |
| --- | --- |
| AUTO-1 | OPERATIONAL — next: post-catch-up vs Runfusion main (pin lag; ~15 commits ahead as of 2026-08-01) |
| AUTO-2 | OPERATIONAL — low-risk finalize + sensitive approve path; parent exit 0 only for DEPLOYED/IDEMPOTENT_NOOP |
| AUTO-3 | OPERATIONAL — deploy + terminal markers; correlation fix landing |

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| `testMode` | `false` |
| `enginePaused` | `true` |

## Maintenance (non-blocking)

- **app-id → client-id:** When org/repo var `APPSOLINO_AUTOMATION_CLIENT_ID` is available, switch every `create-github-app-token@v3` from `app-id: secrets.APPSOLINO_AUTOMATION_APP_ID` to `client-id: vars.APPSOLINO_AUTOMATION_CLIENT_ID`. Keep private key as secret. Not verified available from this agent identity (403 on variables API).

## Current blockers

1. **Land handoff-correlation result PR** — unlocks accurate AUTO-2 parent results and live correlation proof.
2. **Post-catch-up AUTO-1** — Runfusion main ahead of pin; one incremental `automation/upstream-*` after proof (do not reopen AUTO-4).
3. **ISS-GIT-007** — engine merge default-branch fix (after closure).
4. **ISS-UI-001** — PARKED (PR #28); after closure only.

## Milestone board

```text
G0: COMPLETE
G1: PASS
AUTO-1: OPERATIONAL
AUTO-2: OPERATIONAL (handoff correlation landing)
AUTO-3: OPERATIONAL (handoff correlation landing)
AUTO-4: COMPLETE (pin 71576d953626)
Mode: CONTINUOUS UPSTREAM MAINTENANCE
ISS-UI-001: PARKED (do not start until closure PR lands)
```

## Next authorised mission

1. Merge handoff-correlation result PR (sensitive workflows — exact-head owner approval + approve-sensitive, or equivalent trusted path).
2. Disposable low-risk AUTO-2→AUTO-3 correlation proof; record handoff id + child run id.
3. Post-catch-up AUTO-1; process one incremental upstream PR via normal AUTO-2 if divergence remains.
4. Only then: ISS-UI-001 / ISS-GIT-007 backlog.
