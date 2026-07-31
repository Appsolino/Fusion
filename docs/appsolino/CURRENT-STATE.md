# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-07-31T18:10:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `1af5dd92c` (PR #35 merged) |
| Active Host D release | `g13b-0.74.0-beta.5-cadf34dd4` |
| Executable SHA-256 | `3b0f701b7e3fe3c7b5441f784dadb659d439378cc7d858a5bc743463e9cea82a` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Staging result | **G1 PASS** retained on `g13b` |
| Host P state | Deferred |
| Legacy production | DEGRADED / FROZEN |

## Owner priority (2026-07-31)

```text
NOW:     AUTO-3 (after AUTO-2 OPERATIONAL lands)
NEXT:    AUTO-4 catch-up (includes PR #34)
DONE:    AUTO-1 OPERATIONAL; AUTO-2 OPERATIONAL (this mission)
PARKED:  ISS-UI-001 / PR #28
NOTE:    PR #34 is SENSITIVE / UNMERGED — no auto-merge; no Host D deploy until AUTO-3
```

## AUTO-1 — OPERATIONAL

Live App-identity + same-tip idempotency proven. Absorb PR path: `automation/upstream-*`.

## AUTO-2 — OPERATIONAL (this mission)

| Item | Value |
| --- | --- |
| Validate workflow | `upstream-auto2-validate.yml` (candidate zone; no App private key) |
| Finalize workflow | `upstream-auto2-finalize.yml` (trusted zone; App token; no candidate scripts) |
| Classifier | `infra/scripts/auto2-classify-upstream.mjs` |
| Finalizer | `infra/scripts/auto2-finalize.mjs` |
| PR #34 classification | **SENSITIVE** (workflows + migrations + 1085 files + deps/auth/provider/release) |
| PR #34 merged | **NO** |
| Host D during AUTO-2 | unchanged `g13b` |

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| `testMode` | `false` |

## Current blockers

1. **AUTO-3** — immutable Host D build/deploy/rollback for approved absorbs.
2. **PR #34** — SENSITIVE; requires owner approval after AUTO-2 validation; then AUTO-3 for Host D.
3. **ISS-GIT-007** — engine merge default-branch fix before AUTO-3 auto-merge trust on product tasks.
4. **ISS-UI-001** — PARKED (PR #28).

## Milestone board

```text
G0: COMPLETE
G1: PASS
AUTO-1: OPERATIONAL
AUTO-2: OPERATIONAL
AUTO-3: NOW
AUTO-4: BACKLOG (PR #34)
ISS-UI-001: PARKED
```

## Next authorised mission

**AUTO-3** — do not merge PR #34 in AUTO-2 leftovers; keep ISS-UI-001 parked.
