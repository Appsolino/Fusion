# Appsolino operating model

**Governing.** How work is performed.
**Architecture:** [`master-plan/MASTER-PLAN.md`](master-plan/MASTER-PLAN.md).
**Status:** [`CURRENT-STATE.md`](CURRENT-STATE.md) only.
**Reading time:** ≤ 3 minutes.

## Priorities

1. Fast development
2. Protect irreplaceable data
3. Rebuild after total server loss

## Automation first

A recurring manual command sequence is an **automation gap**. Do not design normal operation around repeated owner SSH.

Target pipeline: detect upstream → one integration branch (`merge --no-ff`) → risk classify → affected tests → package → safe auto-merge or one sensitive approval → automated Host D immutable release → health/smoke → rollback on failure.

Interim: read-only upstream monitor. **AUTO-1 OPERATIONAL** prepares absorb PRs. **AUTO-2 OPERATIONAL** classifies/validates and auto-merges only proven low-risk (sensitive → owner approval). AUTO-3 is NOW for Host D: see [`CURRENT-STATE.md`](CURRENT-STATE.md).

## Validation levels

| Level | Use | Target |
| --- | --- | ---: |
| **A** | Most daily / docs / rules | < 10 min |
| **B** | Runtime, DB, service, packaging | < 30 min where practical |
| **C** | Production candidate | Full release validation |

Run only checks required by changed risk. Docs alone do not trigger full builds.

## Branching and PRs

- Primary checkout stays on `main`; feature work uses worktrees.
- `automation/upstream-*`: single active upstream sync (when AUTO-1 exists).
- Lightweight docs/ops may merge after fast review; product, migrations, deploy, auth, upstream sync need PRs.
- Safe automated sync may auto-merge; sensitive waits for **one** owner approval (owner does not redo the work).

## Upstream integration

- Merge upstream with `git merge --no-ff` (do not rebase Appsolino history).
- **Safe:** docs/tests/harmless UI/assets → auto-merge when green → Host D release.
- **Sensitive:** engine, providers, scheduler/executor, migrations, lockfiles, deploy, workflows, auth, DB → automate work; hold for approval.
- Correction A/B contract failures **block** the sync PR.
- New migrations → disposable staging DB proof; always sensitive.
- Do not force-mirror exact upstream tips onto `upstream-shadow`; do not import upstream workflows wholesale; do not use owner interactive OAuth as the durable automation identity.

## Deployment and rollback (Host D)

```text
Build once → hash → install beside previous → switch current → restart → health/smoke
On failure: mark new release failed; restore previous; main may stay merged; report
```

Host P: never automatic until V1B authorised. No production identities on Host D.

## Documentation and issues

- Update [`CURRENT-STATE.md`](CURRENT-STATE.md) in the same PR when status, release, blockers, or next work changes.
- Do not duplicate live status into MASTER-PLAN / OPERATING-MODEL / historical docs.
- Every meaningful incident → create or update **one** GitHub Issue (fingerprint match); CURRENT-STATE links only open high-priority items.
- Historical `master-plan/00`–`15` (except MASTER-PLAN) do not govern.

## Cursor missions

Classify Level A/B/C. Apply timing rule. Stop at authorised scope. Do not start V1B/Host P or the next AUTO phase automatically. Record configured **and** actual provider; mock/`testMode` is not real-provider proof. Report governing conflicts instead of silently picking a side.

### Mission header (paste when useful)

```text
Governing: docs/appsolino/START-HERE.md + MASTER-PLAN + OPERATING-MODEL + CURRENT-STATE
Level: A | B | C
Host P: prohibited unless explicitly authorised
Update CURRENT-STATE.md if status changes
```
