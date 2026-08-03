# Steward S1A — Expert Advisory Mode (DRAFT — NOT AUTHORISED)

**Status:** Draft only. Do **not** implement until:

1. S0 scheduled reconcile is green on `main`, and  
2. Owner explicitly authorises S1A.

**Ledger:** [`../CURRENT-STATE.md`](../CURRENT-STATE.md)  
**Parent policy:** [`STEWARD-POLICY.md`](STEWARD-POLICY.md)

## Purpose

When S0 creates or updates an incident Issue, an expert agent investigates safely and posts structured root-cause advice **on that Issue**. No code mutation, no repair PR, no AUTO dispatch, no Host D deploy, no Host P access.

## Why S1A before S1B

| Stage | Allowed | Forbidden |
| --- | --- | --- |
| **S1A — advice** | Inspect logs/artifacts/trusted `main`; isolated worktree read/tests; post assessment; request evidence | Push branch; open repair PR; merge; redispatch AUTO; deploy; Host P |
| **S1B — repair PR** (later) | Create `repair/<incident-id>`; implement fix + tests; independent reviewer; open PR | Merge; deploy; Host P; automatic redispatch loops |

S1A proves diagnosis quality before granting mutation authority.

## Trigger (proposed)

```text
S0 issue created/updated
→ label steward/needs-expert
→ S1A workflow / mission starts
→ fingerprint lock
→ Fusion engineer mission (pinned provider/model)
→ post Steward Expert Assessment comment
→ relabel:
   steward/advice-ready
   steward/needs-evidence
   steward/repair-recommended
   steward/owner-required
```

Also: explicit `workflow_dispatch` for dry-run tests.

## Evidence package (from S0)

Incident fingerprint · failure class · workflow/job names · run IDs/attempts · relevant logs · parent/child conclusions · AUTO-3 evidence artifact · expected/actual source SHA · active/previous releases · application version · migration ceiling · health · `enginePaused` · Host P access state · changed files / PR metadata.

Governing reads (mandatory): `START-HERE.md`, `MASTER-PLAN.md`, `OPERATING-MODEL.md`, `CURRENT-STATE.md`, `STEWARD-POLICY.md`.

## Investigation rules

1. Classify: pipeline / reporting / merge-conflict / candidate-code / migration / deployment / infrastructure / identity / unknown.
2. Reproduce only when safe (unit tests, YAML parse, isolated worktree build, disposable DB migration, merge simulation). Never Host P, Host D install, release switch, or unauthorised AUTO redispatch.
3. Confidence: HIGH / MEDIUM / LOW. Medium/low must request evidence, not guess.
4. Independent reviewer receives original evidence + diagnosis (+ diff later in S1B) and returns ACCEPT / REJECT / NEEDS_MORE_EVIDENCE — engineer reasoning is not authority.

## Runtime contract (inherits S1 sketch)

```text
Account: fusion
Worktree: /srv/appsolino-fusion/phase-1/worktrees/repair-<incident-id>
Provider/model: pinned; no silent fallback
GitHub identity: Appsolino Automation App
Deployment authority: none
Bounds: attempts, runtime, tokens
```

## Advice comment shape (required)

Use the `## Steward Expert Assessment` structure (incident, what failed, root cause, recommended solution, files, validation, risk, system state, owner decision).

## Repeated failures (proposed)

| Case | Action |
| --- | --- |
| First occurrence | Diagnose and advise |
| Same fingerprint, new occurrence | Compare to prior diagnosis |
| Same proposed solution fails once | Return to diagnosis; do not auto-repeat |
| Same fingerprint fails twice after repair | Escalate to owner; freeze further repair attempts |
| CRITICAL / rollback failure | Advise only; notify owner; no mutation |

## Implementation mission outline (when authorised)

Docs + workflow + engineer launcher only — still no S1B:

1. Extend `STEWARD-POLICY.md` phase gates: S1A authorised, S1B not.
2. Label taxonomy + S0 handoff label `steward/needs-expert` (no S0 trust-zone regression).
3. S1A workflow: issue labeled / manual dispatch → lock → evidence collect → mission → comment → relabel.
4. Fixture pack: sample incidents → assessment markdown golden files; reviewer ACCEPT/REJECT fixtures.
5. Live proof on one non-destructive historical or synthetic incident under owner watch.
6. Stop. Report. Await S1B authorisation separately.

## Explicit non-goals (this draft)

- No automatic merge or deploy  
- No Host P  
- No silent provider fallback  
- No S1B code until separate owner decision  

## Recommendation gate (2026-08-03)

**HOLD S1A.** S0 minute-17 reconcile is red; authoritative recovery and live issue path are not proven. Authorise S1A only after reconcile PASS and issue-path smoke.
