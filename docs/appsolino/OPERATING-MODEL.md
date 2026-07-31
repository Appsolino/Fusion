# Appsolino operating model (personal project)

**Authority:** This file governs *how work is performed*.  
The master plan (`docs/appsolino/master-plan/`) defines architecture and production boundaries. It must not be interpreted as an enterprise compliance programme.

Last updated: 2026-07-31

## Controlling priorities

1. Fast development  
2. Protect irreplaceable data  
3. Rebuild the system after total server loss  

Everything else must be proportionate to actual risk.

## Hard requirements (always)

1. Secrets never go into Git or normal logs.  
2. Production data is backed up before migrations or risky deployments.  
3. Production deployments use a known package/version.  
4. A failed deployment must not destroy the previous working release.  
5. Development agents must not modify production accidentally.  
6. We must know how to rebuild a server and restore the data.

## Philosophy

```text
Build infrastructure from code.
Back up irreplaceable data.
Regenerate everything else.
Run small tests frequently.
Run expensive tests only when their risk applies.
Automate routine development completely.
Require human approval only for high-risk automation results or production activation.
```

---

## 1. Every task gets one validation level

Classify before starting:

| Level | Used for | Target |
| --- | --- | ---: |
| **A — Fast** | Most daily changes | Under 10 minutes |
| **B — Integration** | Executable, database, infrastructure or service changes | Under 30 minutes where practical |
| **C — Release** | A package that may reach production | Full validation |

A normal feature must **not** automatically trigger: clean dependency install, full executable build, backup/restore, staging rebuild, clean Ubuntu rebuild, or the complete acceptance suite — **except** when the automated Host D release / upstream-sync pipelines deliberately run their scoped checks.

### Validation follows the change

```text
Documentation:        diff check only
Ansible:              syntax check + affected playbook
Backup script:        script syntax + one backup/restore test
Dashboard feature:    dashboard tests + quick staging smoke
CLI/runtime change:   relevant tests + package build + staging health
Upstream absorb:      risk-class focused suite + Correction A/B + migration proof when needed
Host D auto-release:  package + health + smoke (retain previous release)
Production release:   complete Level C validation + owner activation
```

Do not run unrelated validation merely because it exists.

### Expensive checks are event-based

| Check | When |
| --- | --- |
| Full build/package | Release, upstream sync automation, or runtime/package change |
| Database restore | Significant migration, backup-system change, or scheduled recovery test |
| Clean-server rebuild | Before production; after major provisioning or OS change |
| Full privilege path | Before autonomous administrative execution |
| Complete release validation | Only for a production candidate |

Optional wrappers (`pnpm check:fast` / `check:integration` / `check:release`) are speed optimisations that call existing package commands. They are **not** a new phase and **not** a prerequisite for continuing product development.

---

## 2. Daily development

```text
Appsolino main → small feature branch → change → relevant tests → PR → merge
→ automated Host D package/build → automatic a.anas.bz staging update
```

| Change type | Expected validation |
| --- | ---: |
| Documentation only | 1–3 minutes |
| Small script/config | 3–10 minutes |
| Isolated application change | 5–15 minutes |
| Packaging/runtime change | 15–30 minutes |
| Full production release | Longer, infrequent, owner-gated |

Cursor must **not** be required to manually rebuild and reinstall Host D after every accepted change once AUTO-D.2 exists.

### Branch / PR policy

- **Lightweight / direct merge OK:** docs, comments, harmless ops text, small non-production scripts, test-only fixes — after fast validation and a reviewed diff with no production impact.  
- **PR required:** product source, migrations, systemd, backup/restore, deployment, auth/secrets, production config, upstream sync automation results.

PRs remain useful for one person (clear diff, Cursor review, history). Sensitive automated sync PRs need **one owner approval**; the owner does not redo the merge/test/build work.

---

## 3. Upstream absorb is automated (Host D)

Normal development continues from Appsolino `main`.

Historical packaged pin (Phase 1 baseline; not a forever freeze):

```text
b85a5d4531df8fa749d77bf85ea4ab9ab960ce86
```

**Permanent model (binding):** automated upstream detection and integration — not operator-driven weekly/monthly merges as the only path. The 2026-07-30 “synchronise intentionally / approximately monthly” wording was a temporary staging-repair scope reduction and is **superseded**.

### Target pipeline (REQUIRED / NOT IMPLEMENTED)

```text
Runfusion/Fusion:main
  → detect (every 6–24h; no-op if unchanged)
  → automation/upstream-* (single active sync; merge --no-ff)
  → risk classification + Correction A/B contract tests
  → migrations → disposable staging DB proof (always sensitive)
  → focused tests + immutable package + temporary staging candidate
  → sync PR: safe auto-merge | sensitive → one owner approval
  → on merge: automated Host D immutable release beside previous
  → health / smoke; automatic rollback on failure
  → a.anas.bz
```

Branch model and risk rules: `docs/appsolino/master-plan/04-fork-and-upstream-update-strategy.md`.

### Interim detection workflow (until AUTO-D.1 lands)

`.github/workflows/upstream-shadow.yml` (**Upstream Monitor**) is **observation-only**:

- daily schedule + `workflow_dispatch`;
- `permissions: contents: read`;
- fetches upstream `main`; records SHAs, merge-base, ahead/behind in the job summary;
- **does not** create/update branches, force-push, merge, install, or build;
- **does not** use external credentials to bypass Actions workflow-file push restrictions.

Exact-tip `upstream-shadow` mirroring **failed** (run `30601438029`) and is **not** the absorb process. Details: `docs/appsolino/upstream/UPSTREAM-MONITORING.md`.

### Hard limits until/unless AUTO-D is implemented

- **Must not** merge upstream into Appsolino `main` from ad-hoc Cursor missions unless the mission is explicitly an upstream-sync / AUTO-D mission.
- **Must not** access Host P or place production secrets on Host D.
- **Must not** import upstream `.github/workflows` wholesale.

`git rerere` remains enabled. Keep Appsolino-specific changes small, isolated, well named, and covered by focused tests (especially Corrections A/B).

---

## 4. Build once

```text
Build package once → calculate hash → test that exact package → deploy that exact package
```

Do not rebuild the same version separately for staging and production. Prefer shared store `/srv/appsolino-fusion/cache/pnpm/` and `pnpm install --frozen-lockfile --prefer-offline`. Clean installs only for releases, upstream sync automation, or suspected corruption.

Docs / Ansible / backup / monitoring scripts: no Fusion product build unless product code changed.

Host D automated release must retain the previous working release and roll back on failure. Main may remain merged while the bad release is marked failed.

---

## 5. Back up only irreplaceable assets

**Required (production):**

- PostgreSQL data and migration history  
- Uploaded/user files outside PostgreSQL  
- Encrypted secrets and configuration  
- Source and infrastructure code in GitHub  
- A small release-identity record  

**Optional:** latest one or two production packages for quick rollback.

**Do not back up off-host:** `node_modules`, pnpm caches, build directories, development/staging databases, worktrees, temporary logs, OS packages, generated artefacts, Cursor workspaces, historical candidate trees. These are regenerated.

**Logs:** 7–14 days local; longer only for real production incidents.

### Production backup schedule

- Daily DB: retain 7  
- Weekly DB: retain 4  
- Always before deployment/migration  
- Restore test: before first production launch; after significant migrations; monthly/quarterly; after backup-script or storage-provider changes — not every backup  

### Recovery

```text
New Ubuntu → cloud-init/Ansible → clone Appsolino/Fusion → restore secrets
→ install selected package → empty production DB → restore dump
→ restore uploads if any → start Fusion → verify version/health/migrations
```

Do not recover old staging state, caches, worktrees, or rebuildable artefacts.

---

## 6. `NOT PROVEN` does not automatically block development

A missing proof blocks **only** the capability that depends on it:

| Missing proof | What it blocks |
| --- | --- |
| Off-host backup | Production launch |
| Clean rebuild | Production readiness |
| Real Fusion engine-child admin path | Autonomous host-admin execution |
| Full release test | Production deployment of that release |
| AUTO-D upstream/Host D release | Claiming development is fully automated; large catch-up remains high-touch until implemented |
| V1A.3 real-provider credential | Claiming real-provider Host D development readiness |

These do **not** block ordinary feature work, staging docs, or packaging experiments that stay off Host P.

---

## 7. Stop after completing the requested scope

Cursor missions must not automatically:

- add another framework;
- create extra governance documents;
- expand the phase;
- redesign unrelated systems;
- run every available test;
- begin the next phase;
- preserve unnecessary artefacts;
- fix unrelated issues encountered during validation;
- access Host P or start V1B;
- attempt the multi-hundred-commit upstream catch-up as a manual merge unless that is the explicit mission after AUTO-D design exists.

Unrelated findings are recorded briefly and deferred.

---

## 8. Standard header for future Cursor missions

Paste at the start of implementation instructions:

```text
Appsolino personal-project operating model
-------------------------------------------

Governing process:
docs/appsolino/OPERATING-MODEL.md

This is a one-person personal project, not an enterprise compliance programme.

Governing principle:
Automate routine development completely. Require human approval only when
automation detects high risk, or before production activation.

Before implementation:
1. Classify this mission as validation Level A, B or C.
2. State the tests required by the actual changed risk.
3. State the expected time budget.
4. Do not add unrelated validation, evidence, infrastructure or governance.
5. Do not perform clean installs/full builds unless this validation level requires them.
6. Do not pull or merge upstream unless the mission is explicitly an upstream-sync / AUTO-D mission.
7. Back up only irreplaceable production data; regenerate build/staging assets.
8. Treat NOT PROVEN as blocking only the capability that depends on that proof.
9. Stop when the authorised scope is complete.
10. Do not begin the next phase automatically (including V1B / Host P).
11. Record the actual UTC start time before the first implementation action.
12. Record the UTC stop time after final validation.
13. Calculate and report actual wall-clock duration.
14. Never infer missing timing values.
15. Host P access and production identities on Host D remain prohibited until explicitly authorised.
```

---

## Current project state

```text
Phase 0: COMPLETE
Phase 1: COMPLETE
Phase 2A: PARTIAL / MERGED
Staging foundation: USABLE
a.anas.bz: ACTIVE / AUTHENTICATED
Daily development: FAST TARGETED VALIDATION (Host D auto-release REQUIRED / NOT IMPLEMENTED)
V1A.2: PASS WITH OBSERVATIONS
V1A.3: BLOCKED — non-production provider credential required
Upstream sync: AUTOMATED INTEGRATION REQUIRED / NOT IMPLEMENTED
  (interim: read-only detection workflow only; no upstream-shadow absorb)
Off-host backup: REQUIRED BEFORE PRODUCTION
Clean rebuild: REQUIRED ONCE BEFORE PRODUCTION
Engine-child admin proof: REQUIRED BEFORE AUTONOMOUS HOST-ADMIN
Host P: deferred
Production: DEGRADED / FROZEN / not started
```

Phase 2A merge: `6caca1ec66e8428493982e29241e47df0857be00` (PR #10). Corrected V1A.2 candidate: `v1a2-0.74.0-beta.5-3bc46bffe`.
