# Steward S1A — Expert Advisory Mode

**Status:** **APPROVED / AUTHORISED** (advice only)  
**Ledger:** [`../CURRENT-STATE.md`](../CURRENT-STATE.md)  
**Parent policy:** [`STEWARD-POLICY.md`](STEWARD-POLICY.md)

S1B repair PR agent remains **NOT AUTHORISED**.

## Purpose

When an eligible steward incident Issue is labeled `steward/needs-expert` (or via `workflow_dispatch`), S1A investigates safely and posts a structured **Steward Expert Assessment** comment. No code mutation, no repair PR, no AUTO dispatch, no Host D deploy, no Host P access.

## Phase gates

| Stage | Status | Allowed | Forbidden |
| --- | --- | --- | --- |
| **S0** | ACCEPTED / enabled | Observe, fingerprint, upsert issues | Repair, dispatch, merge, deploy |
| **S1A — advice** | **AUTHORISED** | Inspect trusted `main`; evidence pack; engineer + independent reviewer; post assessment; relabel | Push branch; open repair PR; merge; redispatch AUTO; deploy; Host P |
| **S1B — repair PR** | **NOT AUTHORISED** | — | Everything mutation-related until separate owner decision |

## Trigger

```text
Eligible open steward issue
→ label steward/needs-expert
→ (automatic handoff OFF until proof: S1A_AUTO_HANDOFF must be true for labeled events)
→ or workflow_dispatch with issue_number + mode
→ fingerprint + occurrence lock (steward/expert-running)
→ evidence pack → engineer (pinned provider/model) → independent reviewer
→ one revision if REJECT
→ post Steward Expert Assessment comment (idempotent by fingerprint+occurrence)
→ relabel advice-ready | needs-evidence | repair-recommended | owner-required | expert-failed
```

Optional S0 create-time handoff label `steward/needs-expert` only when `STEWARD_S0_HANDOFF_S1A=1` (default **OFF**).

## Labels (create via API in live upsert if missing, or owner)

| Label | Meaning |
| --- | --- |
| `steward/needs-expert` | Eligible for S1A launch |
| `steward/expert-running` | Active advisory lock |
| `steward/advice-ready` | Accepted assessment posted |
| `steward/needs-evidence` | Reviewer / engineer request more evidence |
| `steward/repair-recommended` | Advice recommends a future S1B repair (not authorised yet) |
| `steward/owner-required` | CRITICAL / SENSITIVE / escalation |
| `steward/expert-failed` | Revision budget exhausted or hard failure |

## Runtime contract

```text
Account: fusion
Worktree: preferred $S1A_WORKTREE_ROOT/repair-<incident-id>
          else $RUNNER_TEMP/repair-<incident-id> on GHA
Provider/model: appsolino-s1a-deterministic / appsolino-s1a-deterministic-v1 (pinned)
               S1A_ENGINE=cursor fails closed without API key (no silent fallback)
GitHub identity: Appsolino Automation App (issues write job only)
Deployment authority: none
Bounds: maxAttempts=2, maxRuntimeMs=600000, maxTokens=0, assessment-version=1
```

Record `configuredProvider`/`configuredModel` and `actualProvider`/`actualModel` — must match.

## Advice comment shape

Required sections under `## Steward Expert Assessment`: Incident, What failed, Root cause, Recommended solution, Files, Validation, Risk, System state, Owner decision.

Hidden marker:

```html
<!-- appsolino-s1a-assessment:
fingerprint=...
occurrence=...
assessment-version=1 -->
```

## Investigation rules

1. Classify from evidence (not hardcoded issue text): generated baselines → regeneration; semantic sources (`executor.ts`, `packages/*`) → history/tests; workflow/migration/lockfile flags → SENSITIVE.
2. Reproduce only when safe. Never Host P, Host D install, release switch, or AUTO redispatch.
3. Confidence HIGH / MEDIUM / LOW. Medium/low must request evidence, not guess.
4. Independent reviewer receives **only** `{evidencePack, assessment}` — returns ACCEPT | REJECT | NEEDS_MORE_EVIDENCE.

## Explicit non-goals

- No automatic merge or deploy  
- No Host P  
- No silent provider fallback  
- No S1B repair code or repair branch  
- Do not close/resolve unrelated sync PRs as part of S1A  

## Implementation package

`infra/scripts/steward/s1a/` — pure Node ESM with injectable clients.  
Workflow: `.github/workflows/upstream-reliability-steward-s1a.yml`.

## Proof path

1. Fixture-replay CI / local `node --test infra/scripts/steward/s1a/__tests__/*.test.mjs`  
2. Authority greps on workflow (no Host D/P secrets, no `gh workflow run`)  
3. Owner-watched live dispatch on one eligible historical/synthetic incident  
4. Only then consider enabling `S1A_AUTO_HANDOFF=true` and/or `STEWARD_S0_HANDOFF_S1A=1`  
5. Stop. Await separate S1B authorisation.  
