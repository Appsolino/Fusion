# Upstream Reliability Steward — policy

**Phase:** S0 ACCEPTED · S1A AUTHORISED (advice) · S1B NOT AUTHORISED  
**Authority:** Complements AUTO-1/2/3; does not replace them.  
**Status ledger:** [`../CURRENT-STATE.md`](../CURRENT-STATE.md)

## Purpose

Detect, fingerprint, and record AUTO pipeline failures as durable GitHub Issues (S0).  
When authorised, assign an advisory expert (S1A) that posts structured root-cause advice.  
S1B (repair PR agent) is **not** authorised. Steward does **not** merge, deploy, or access Host P.

## Detection (S0)

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

## Issue behaviour (S0)

| Case | Action |
| --- | --- |
| New fingerprint | Create one issue |
| Open fingerprint | Append occurrence (if new occurrence id) |
| Closed fingerprint recurring | Reopen + append |
| Same occurrence twice | No-op |

### Optional S0 → S1A handoff label

When creating open incidents, S0 may **optionally** attach `steward/needs-expert` **only if** env `STEWARD_S0_HANDOFF_S1A=1`.  
**Default: OFF** — automatic handoff stays disabled until after S1A proof.

Labeled-event auto-launch for S1A additionally requires repository variable / env `S1A_AUTO_HANDOFF=true`. If not `true`, labeled events exit 0 with skip.

## Trust / security

- Checkout **trusted `main` only**
- Never checkout failing PR head
- Never execute candidate scripts or artifact code
- Treat logs, artifacts, PR fields as **untrusted**; escape Markdown
- Workflow `permissions` are read-only (`contents`/`actions`/`pull-requests`). **No** workflow-level `issues: write`.
- Issue / comment upsert: Appsolino Automation App token only (`permission-issues: write`)
- Steward workflows must **never reference** Host D/P secret expressions (static YAML guard)
- Never `gh workflow run` / `gh run rerun` from Steward
- Unavailable physical fields in S0 are JSON `null` — never invented. S1A advisory packs may apply documented defaults (`mutatedMain=false`, `deployedHostD=false`, `hostPAccessed=false`, `enginePaused=true`) when unknown for advice rendering only.

## Physical evidence (without deploy access)

Compare when available:

1. AUTO-2 parent JSON / claimed terminal  
2. AUTO-3 child conclusion  
3. Last structured `AUTO3_TERMINAL_STATUS` marker  
4. AUTO-3 evidence artifact (`schemaVersion: 1`)  
5. Expected merged SHA  

Evidence artifact fields: `sourceSha`, `releaseId`, `applicationVersion`, `terminal`, `highestMigration`, `health`, `enginePaused`, `hostPAccessed`, `previousRelease`, `recordedUtc`.

## S0 forbidden

repair-code-generation · repair-branch · workflow-dispatch (of AUTO) · workflow-rerun · auto-merge · auto3-deploy · host-d-ssh-install · host-p-access · candidate-checkout · candidate-script-execution · owner-oauth-as-routine-identity

## S1A authorised (advice only)

Package: `infra/scripts/steward/s1a/` · Policy doc: [`S1A-EXPERT-ADVISORY.md`](S1A-EXPERT-ADVISORY.md)

### Labels

`steward/needs-expert` · `steward/expert-running` · `steward/advice-ready` · `steward/needs-evidence` · `steward/repair-recommended` · `steward/owner-required` · `steward/expert-failed`

Owner may create these labels; live upsert may ensure they exist via API.

### Idempotency

Assessment comments are keyed by hidden marker `fingerprint` + `occurrence`. Same key → no duplicate assessment. New occurrence → new assessment comment. One engineer revision after reviewer REJECT.

### Runtime bounds

`maxAttempts=2` · `maxRuntimeMs=600000` · `maxTokens=0` (deterministic) · `assessment-version=1`

Pinned provider/model: `appsolino-s1a-deterministic` / `appsolino-s1a-deterministic-v1`.  
`S1A_ENGINE=cursor` without API key **fails closed** — no silent fallback to deterministic.

### S1A forbidden (inherits S0 +)

repair-pr · silent-provider-fallback · Host P · AUTO dispatch/rerun · repair branch push

## S1B prohibited

No repair code for conflict resolution committed under S1A. No `repair/<incident-id>` branch push. No hidden S1B. Await separate owner authorisation.

## AUTO-1 structured outcome (authoritative)

Parse the AUTO-1 JSON / `outcome=` result **before** generic log signatures. Never classify AUTO-1 as `correlation-race` without explicit handoff/child-selection evidence.

| AUTO-1 `outcome` | Steward treatment |
| --- | --- |
| `no-change` | No incident |
| `merged` | No incident |
| `conflict` | `upstream-merge-conflict` (retain upstream SHA, sync PR, conflicted files, `mutatedMain=false`, `deployedHostD=false`) |
| unknown / missing with failed conclusion | `needs-triage` |

## Agent runtime contract

```text
Account: fusion
Worktree: /srv/appsolino-fusion/phase-1/worktrees/repair-<incident-id>
          (or $S1A_WORKTREE_ROOT / $RUNNER_TEMP on GHA)
Provider/model: explicitly pinned; fallback disabled
Bounds: attempts, runtime, tokens
GitHub identity: Appsolino Automation App
Deployment authority: none
```

Record: configuredProvider/Model, actualProvider/Model, missionId, incidentFingerprint, worktree.  
`repairHeadSha` is S1B-only (forbidden while S1B not authorised).

## Reviewer independence (S1A+)

Engineer receives evidence and produces advice (S1A). Reviewer receives original evidence + diagnosis only — **not** engineer scratchpads — and returns ACCEPT / REJECT / NEEDS_MORE_EVIDENCE.

## Phase gates

| Phase | Status |
| --- | --- |
| S0 observation | **ACCEPTED** / enabled on `main` |
| S1A expert advisory | **AUTHORISED** — [`S1A-EXPERT-ADVISORY.md`](S1A-EXPERT-ADVISORY.md) |
| S1B repair PR agent | **Not authorised** |
| S2 low-risk auto-merge | Not authorised |
| S3 sensitive assist | Not authorised |
