# Appsolino operating model (personal project)

**Authority:** This file governs *how work is performed*.  
The master plan (`docs/appsolino/master-plan/`) defines architecture and production boundaries. It must not be interpreted as an enterprise compliance programme.

Last updated: 2026-07-30

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
Synchronise upstream intentionally, not continuously.
```

---

## 1. Every task gets one validation level

Classify before starting:

| Level | Used for | Target |
| --- | --- | ---: |
| **A — Fast** | Most daily changes | Under 10 minutes |
| **B — Integration** | Executable, database, infrastructure or service changes | Under 30 minutes where practical |
| **C — Release** | A package that may reach production | Full validation |

A normal feature must **not** automatically trigger: clean dependency install, full executable build, backup/restore, staging rebuild, clean Ubuntu rebuild, or the complete acceptance suite.

### Validation follows the change

```text
Documentation:        diff check only
Ansible:              syntax check + affected playbook
Backup script:        script syntax + one backup/restore test
Dashboard feature:    dashboard tests + quick staging smoke
CLI/runtime change:   relevant tests + package build + staging health
Production release:   complete Level C validation
```

Do not run unrelated validation merely because it exists.

### Expensive checks are event-based

| Check | When |
| --- | --- |
| Full build/package | Release, upstream sync, or runtime/package change |
| Database restore | Significant migration, backup-system change, or scheduled recovery test |
| Clean-server rebuild | Before production; after major provisioning or OS change |
| Full privilege path | Before autonomous administrative execution |
| Complete release validation | Only for a production candidate |

Optional wrappers (`pnpm check:fast` / `check:integration` / `check:release`) are speed optimisations that call existing package commands. They are **not** a new phase and **not** a prerequisite for continuing product development.

---

## 2. Daily development

```text
Appsolino main → small feature branch → change → relevant tests → quick smoke → merge
```

| Change type | Expected validation |
| --- | ---: |
| Documentation only | 1–3 minutes |
| Small script/config | 3–10 minutes |
| Isolated application change | 5–15 minutes |
| Packaging/runtime change | 15–30 minutes |
| Full release | Longer, infrequent |

### Branch / PR policy

- **Lightweight / direct merge OK:** docs, comments, harmless ops text, small non-production scripts, test-only fixes — after fast validation and a reviewed diff with no production impact.  
- **PR required:** product source, migrations, systemd, backup/restore, deployment, auth/secrets, production config, upstream sync.

PRs remain useful for one person (clear diff, Cursor review, history). No two-person enterprise approval chain.

---

## 3. Upstream is pinned

Normal development continues from Appsolino `main`.

Pinned baseline:

```text
b85a5d4531df8fa749d77bf85ea4ab9ab960ce86
```

Synchronise intentionally — approximately monthly, or when there is a needed feature, bug fix, or security fix. **Not** before every task.

### Automated shadow monitoring (observation only)

GitHub Actions workflow `.github/workflows/upstream-shadow.yml` runs **daily** and:

- fetches `https://github.com/Runfusion/Fusion.git` `main`;
- force-pushes that exact tip to Appsolino branch `upstream-shadow`;
- records upstream SHA and ahead/behind vs Appsolino `main` in the job summary.

Hard limits for the shadow job:

- **Must not** merge into Appsolino `main`.
- **Must not** overwrite `main`.
- **Must not** run `pnpm` install/build or full product CI.

Details: `docs/appsolino/upstream/UPSTREAM-MONITORING.md`.

### Controlled sync PR (intentional)

When a sync is justified, open a human-controlled branch and PR — never promote `upstream-shadow` itself:

```text
Appsolino main
  → sync/upstream-YYYY-MM-DD
  → fetch/merge upstream once
  → resolve conflicts once (including migrations / Appsolino-only surfaces)
  → integration tests
  → packaged staging smoke
  → merge via PR
```

Keep intentional sync. **Never** auto-overwrite `main` from monitoring or from an unreviewed upstream tip.

`git rerere` remains enabled. Keep Appsolino-specific changes small, isolated, well named, and covered by focused tests.

---

## 4. Build once

```text
Build package once → calculate hash → test that exact package → deploy that exact package
```

Do not rebuild the same version separately for staging and production. Prefer shared store `/srv/appsolino-fusion/cache/pnpm/` and `pnpm install --frozen-lockfile --prefer-offline`. Clean installs only for releases, upstream sync, or suspected corruption.

Docs / Ansible / backup / monitoring scripts: no Fusion product build unless product code changed.

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

These do **not** block ordinary feature work, staging, packaging, or manual administration.

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
- fix unrelated issues encountered during validation.  

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

Before implementation:
1. Classify this mission as validation Level A, B or C.
2. State the tests required by the actual changed risk.
3. State the expected time budget.
4. Do not add unrelated validation, evidence, infrastructure or governance.
5. Do not perform clean installs/full builds unless this validation level requires them.
6. Do not pull or merge upstream unless the mission is explicitly an upstream-sync mission.
7. Back up only irreplaceable production data; regenerate build/staging assets.
8. Treat NOT PROVEN as blocking only the capability that depends on that proof.
9. Stop when the authorised scope is complete.
10. Do not begin the next phase automatically.
```

---

## Current project state

```text
Phase 0: COMPLETE
Phase 1: COMPLETE
Phase 2A: PARTIAL / MERGED
Staging foundation: USABLE
Daily development: FAST TARGETED VALIDATION
Upstream sync: MANUAL / SCHEDULED (shadow monitor automated; main never auto-overwritten)
Off-host backup: REQUIRED BEFORE PRODUCTION
Clean rebuild: REQUIRED ONCE BEFORE PRODUCTION
Engine-child admin proof: REQUIRED BEFORE AUTONOMOUS HOST-ADMIN
Production: DEGRADED / FROZEN
```

Phase 2A merge: `6caca1ec66e8428493982e29241e47df0857be00` (PR #10). Corrected head: `409fafcff8ee02a2f7137adc192319c69e9cd6e7`.
