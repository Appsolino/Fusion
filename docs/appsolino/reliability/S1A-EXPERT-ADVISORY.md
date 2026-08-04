# Steward S1A — Expert Advisory Mode

**Status:** **APPROVED / AUTHORISED** (advice only) — implementation rewrite in PR #76  
**Ledger:** [`../CURRENT-STATE.md`](../CURRENT-STATE.md)  
**Parent policy:** [`STEWARD-POLICY.md`](STEWARD-POLICY.md)

S1B repair PR agent remains **NOT AUTHORISED**.

## Purpose

Eligible steward incidents receive a **real Cursor CLI expert investigation** (`cursor-cli` / `composer-2.5`) plus an **independent reviewer process**, then a structured assessment comment. No repair branch, merge, AUTO dispatch, Host D/P access.

## Architecture (trust zones)

```text
Dispatch / labeled event (auto handoff OFF by default)
        │
        ▼
Analyze job — self-hosted appsolino-fusion-control (user=fusion)
  GITHUB_TOKEN read-only (no App issues-write)
  • eligibility + repo allowlist (Appsolino/Fusion only)
  • evidence pack (issue, PR, logs, conflict sides, history)
  • isolated worktree: /srv/appsolino-fusion/phase-1/worktrees/repair-<id>
  • cursor-agent --mode ask --model composer-2.5
  • separate reviewer child process (path-heuristics only)
  • destroy worktree; upload assessment-artifact.json
        │
        ▼
Writer job — ubuntu-latest
  App token: Issues write ONLY
  • validate artifact schema / fingerprint / occurrence / engine≠fixture
  • upsert assessment comment + labels
  • never imports engineer/reviewer/cursor-engine
```

## Live provider (pinned)

```text
configuredProvider = actualProvider = cursor-cli
configuredModel    = actualModel    = composer-2.5
```

Actual values require execution evidence (model listed by `cursor-agent models`, spawn `--model`, successful assessment parse). Fail closed on missing binary/auth/model. **No silent fallback** to the fixture engine.

## Fixture engine

`S1A_ENGINE=fixture` (`appsolino-s1a-fixture` / `appsolino-s1a-fixture-v1`) is **CI / fixture-replay only**. Live mode rejects it.

## Physical evidence

Unknown physical fields remain JSON `null` (`enginePaused`, `hostPAccessed`, `health`). Never invent safe defaults. Issue evidence may set `mutatedMain` / `deployedHostD` when present.

## Labels

| Label | Owner |
| --- | --- |
| `steward/needs-expert` | S0 optional / operator |
| `steward/expert-running` | Writer (transient) |
| `steward/advice-ready` / `needs-evidence` / `repair-recommended` / `owner-required` / `expert-failed` | Writer after review |

Automatic handoff: `S1A_AUTO_HANDOFF` and `STEWARD_S0_HANDOFF_S1A` remain **OFF** until post-merge controlled proof on issue #74.

## Explicit non-goals

No repair PR/code · no merge · no AUTO dispatch/rerun · no Host D/P · no Runfusion publication · no S1B.
