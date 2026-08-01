# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-01T04:56:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `04a7b4cf519f29afbb0612414a0badbb18143f31` (PR #46 admit-main-fetch) |
| Active Host D release | `auto3-0.74.0-beta.5-a1b78a197860` |
| Executable SHA-256 | `d96d3da599598a02239c9e0ae499f4b6571a9d372f6add3a32d9e7aabdc27497` |
| Archive SHA-256 | `8719344cea79fbe90d6d29361fa47f33460095443aea058f01fb166d797b8773` |
| Migration-set SHA-256 | `29bd6c6f3ce78948cee5a5c4abb5f83adb99e94b9af941292b000d88f4c2d45e` |
| Source SHA | `a1b78a19786063b1cfc79ff14e14d352e929bf55` |
| Previous rollback release | `g13b-0.74.0-beta.5-cadf34dd4` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Host P state | Deferred / untouched |
| Legacy production | DEGRADED / FROZEN |

## Owner priority (2026-08-01)

```text
NOW:     Land AUTO-2 sensitive-approval correction PR, then restore App installation
         permissions (contents/PR/workflows/actions write), then owner-approve AUTO-4 #47
DONE:    AUTO-1 OPERATIONAL; AUTO-2 classify/validate OPERATIONAL; AUTO-3 OPERATIONAL
PARKED:  ISS-UI-001 / PR #28
NOTE:    PR #34 CLOSED (superseded by #47). Do not merge #47 until correction lands + App perms + exact-head approval.
```

## AUTO-3 — OPERATIONAL

| Item | Value |
| --- | --- |
| Build workflow | `upstream-auto3-deploy.yml` (credential-free build zone) |
| Deploy identity | `appsolino-deploy` + env `host-d-staging` (forced-command SSH) |
| Deploy entry | `infra/scripts/auto3-deploy.sh` (staging + proof profiles) |
| Active release | `auto3-0.74.0-beta.5-a1b78a197860` |
| Host P accessed | **NO** |

## AUTO-2 sensitive approval path (this mission)

**Prior gap (accurate):** AUTO-2 classified sensitive PRs correctly as `approval-required`, but `auto2-finalize.mjs` never merged even when `ownerApproved=true`. There was no trusted post-approval merge workflow and no exact-head GitHub review verification.

| Item | Value |
| --- | --- |
| New workflow | `upstream-auto2-approve-sensitive.yml` (dispatch-only, trusted main code) |
| Verification | Exact-head APPROVED review from `Anas966`; checks green; `automation/upstream-*` |
| Merge | `gh pr merge --merge --match-head-commit <approved_head>` then AUTO-3 |
| Boolean `--owner-approved` alone | **Not** authorization (blocked) |
| App token mint (Phase 1) | **Still failing** — installation lacks requested write permissions |
| Disposable proof | PR #48 no-approval→hold; approved exact-head merge to disposable base; stale blocked; main/Host D unchanged |
| PR #47 | **UNMERGED** — do not ask owner to approve until this correction is on main + App perms restored |

## AUTO-1 / AUTO-2

Classify/validate remain OPERATIONAL. Low-risk finalize + AUTO-3 dispatch remain the happy path once App token mint works. Sensitive merges use **Upstream AUTO-2 Approve Sensitive** after owner GitHub approval of the exact head.

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| `testMode` | `false` |
| `enginePaused` | `true` |

## Current blockers

1. **App installation permissions** — restore `contents/pull-requests/workflows/actions: write` so finalize/approve-sensitive can mint tokens.
2. **AUTO-2 sensitive-approval correction** — land the open correction PR on main.
3. **AUTO-4 PR #47** — SENSITIVE; exact head `f42eaa96ff1e060d0d00416f62d21843902f8b51`; awaiting correction + App perms + owner exact-head approval.
4. **ISS-GIT-007** — engine merge default-branch fix still open.
5. **ISS-UI-001** — PARKED (PR #28).

## Milestone board

```text
G0: COMPLETE
G1: PASS
AUTO-1: OPERATIONAL
AUTO-2: OPERATIONAL (sensitive post-approval path landing; App perms need restore)
AUTO-3: OPERATIONAL
AUTO-4: READY FOR OWNER APPROVAL after correction + App perms (PR #47)
ISS-UI-001: PARKED
```

## Next authorised mission

1. Merge AUTO-2 sensitive-approval correction PR.
2. Owner restores GitHub App installation permissions.
3. Re-dispatch finalize on #47 (expect approval-required, no merge) to prove token mint.
4. Owner APPROVES PR #47 exact head on GitHub, then dispatches **Upstream AUTO-2 Approve Sensitive**.
