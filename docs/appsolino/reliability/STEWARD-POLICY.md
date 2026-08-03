# Upstream Reliability Steward — policy

**Phase:** S0 (observation only) — enabled on `main`  
**Authority:** Complements AUTO-1/2/3; does not replace them.  
**Status ledger:** [`../CURRENT-STATE.md`](../CURRENT-STATE.md)

## Purpose

Detect, fingerprint, and record AUTO pipeline failures as durable GitHub Issues so S1A can later assign an advisory expert (and S1B a repair agent, only after authorisation). S0 does **not** diagnose as an expert, repair code, open repair PRs, dispatch workflows, merge, or deploy.

## Detection

| Path | Mechanism |
| --- | --- |
| Fast | `workflow_run` on named AUTO-1/2/3 workflows |
| Authoritative recovery | Hourly schedule at minute **37** (`37 * * * *`) |

Do not build long `workflow_run` chains beyond steward. Later phases resume via explicit dispatch + durable incident state.

## Fingerprint (stable)

Hash only:

```text
workflow family
failed phase
normalized terminal status
normalized error signature
affected component
failure class
```

**Never** include: run ID, job ID, timestamp, attempt, handoff nonce, temporary path, runner name.

Hidden issue marker:

```html
<!-- appsolino-steward-fingerprint: sha256:<digest> -->
```

Occurrence id (evidence only): `workflow-run:<run-id>:attempt:<attempt>`

## Issue behaviour

| Case | Action |
| --- | --- |
| New fingerprint | Create one issue |
| Open fingerprint | Append occurrence (if new occurrence id) |
| Closed fingerprint recurring | Reopen + append |
| Same occurrence twice | No-op |

## Trust / security (S0)

- Checkout **trusted `main` only**
- Never checkout failing PR head
- Never execute candidate scripts or artifact code
- Treat logs, artifacts, PR fields as **untrusted**; escape Markdown
- Workflow `permissions` are read-only (`contents`/`actions`/`pull-requests`). **No** workflow-level `issues: write`.
- Issue upsert: Appsolino Automation App token only (`permission-issues: write`), under `steward-s0-issue-upsert` concurrency
- Steward workflow must **never reference** Host D/P secret expressions (static YAML guard)
- Unavailable physical fields are JSON `null` — never invented safe values (`enginePaused`/`hostPAccessed`)

## Physical evidence (without deploy access)

Compare when available:

1. AUTO-2 parent JSON / claimed terminal  
2. AUTO-3 child conclusion  
3. Last structured `AUTO3_TERMINAL_STATUS` marker  
4. AUTO-3 evidence artifact (`schemaVersion: 1`)  
5. Expected merged SHA  

Evidence artifact fields: `sourceSha`, `releaseId`, `applicationVersion`, `terminal`, `highestMigration`, `health`, `enginePaused`, `hostPAccessed`, `previousRelease`, `recordedUtc`.

A future read-only `auto3-status` Host D probe may strengthen live verification; it must not install or switch releases.

## S0 forbidden

repair-code-generation · repair-branch · workflow-dispatch (of AUTO) · workflow-rerun · auto-merge · auto3-deploy · host-d-ssh-install · host-p-access · candidate-checkout · candidate-script-execution · owner-oauth-as-routine-identity

## S0 acceptance (fixture-based)

Historical fixtures (no deliberate live failures):

- wrong AUTO-3 child correlation  
- workflow YAML parse  
- summary SyntaxError  
- false `DEPLOYED` marker  
- package-version drift  
- generated census conflict  
- success / no-change  

Also: needs-triage unknown; parent/child disagreement; missing child after timeout; idempotent reconciliation.

## Agent runtime contract (defined for S1A/S1B; not executed while S0-only)

```text
Account: fusion
Worktree: /srv/appsolino-fusion/phase-1/worktrees/repair-<incident-id>
Provider/model: explicitly pinned; fallback disabled unless policy allows
Bounds: attempts, runtime, tokens
GitHub identity: Appsolino Automation App
Deployment authority: none
```

Record: configuredProvider/Model, actualProvider/Model, missionId, incidentFingerprint, worktree, baseSha, repairHeadSha (S1B only).

## Reviewer independence (S1A+)

Engineer receives evidence and produces advice (S1A) or a patch (S1B). Reviewer receives original evidence + diagnosis and, for S1B, diff + tests — **not** engineer reasoning as authority — and returns ACCEPT / REJECT / NEEDS_MORE_EVIDENCE. Low-risk auto-remediation (S2) requires classifier LOW ∧ tests ∧ reviewer ACCEPT ∧ checks ∧ exact head.

## Phase gates

| Phase | Status |
| --- | --- |
| S0 observation | Enabled on `main` — fixture PASS; scheduled reconcile must be green before S1A |
| S1A expert advisory | **Not authorised** — draft only: [`S1A-MISSION-DRAFT.md`](S1A-MISSION-DRAFT.md) |
| S1B repair PR agent | **Not authorised** — after S1A proves useful |
| S2 low-risk auto-merge | Not authorised |
| S3 sensitive assist | Not authorised |
