> **Status: Historical/reference**
> This document does not override `MASTER-PLAN.md`, `OPERATING-MODEL.md` or `CURRENT-STATE.md`.

# Backup, Disaster Recovery, and Rebuild

Last updated: 2026-07-30

Governing personal-project policy: `docs/appsolino/OPERATING-MODEL.md`.
Back up irreplaceable production data; regenerate caches, staging state, and rebuildable artefacts.
Off-host backup and clean rebuild are **pre-production** proofs, not per-feature gates.

## Objectives (proposed)

| Objective | Target |
| --- | --- |
| RPO (database) | ≤ 24 h with daily full; stretch ≤ 1 h with WAL/incremental |
| RTO (full server) | ≤ 4 h to healthy empty-queue platform; ≤ 8 h including validation |
| In-flight agent work | Tolerated loss — tasks resume from durable checkpoints or terminal retryable state |
| Maximum DB data loss | Equal to RPO; never silent |
| Backup delete from Fusion host | Impossible (separate append-only credentials) |

## Current host evidence (fact)

Scripts/timers already exist under `/srv/software-factory/integrations/fusion-update/`:

- `fusion-remote-backup` — supports github-release (age), restic, rclone; requires config; retention ≥ 14 daily
- `fusion-backup-verify`, `fusion-dr-restore-drill`, `fusion-disaster-recovery`
- Timers enabled for remote backup, backup verify, DR restore drill

**Inference:** tooling intent is aligned; identity drift shows automation alone is insufficient without release/schema gates and restore proof.

## 1. PostgreSQL

| Control | Spec |
| --- | --- |
| Daily full | `pg_dump` custom format or base backup — encrypted off-host |
| Incremental / WAL | Recommended for Tier 2+ (PITR) |
| Retention | ≥ 14 daily; ≥ 4 weekly; ≥ 3 monthly |
| Compression | Yes |
| Encryption | age or restic native; no plaintext secrets remote |
| Off-host | Separate account/bucket; append-only or object-lock preferred |
| Restore verification | Automated restore to disposable instance weekly |

**Pre-migration backup:** mandatory exclusive dump before every production migration.

## 2. GitHub

- Protected `appsolino/main`, `appsolino/stable`, `release/*`
- Immutable tags matching release IDs
- Regular push of completed source (accepted)
- Commit SHA in release manifest
- Mirror `upstream/main` FF-only

## 3. Secrets

| Secret | Storage | Recovery |
| --- | --- | --- |
| Fusion master key | Offline + sealed backup (not only on Fusion host) | Dual custody |
| Provider credentials | Host env / secret store; scoped | Rotation runbook |
| GitHub App / PAT | Fine-grained; staging vs prod split | Rotation |
| Backup encryption keys | Separate from Fusion sudo world | Paper/offline |
| DB credentials | Distinct prod/staging | Rotation |

Fusion host must not hold credentials that can delete backup vaults.

## 4. Configuration backup

Version in Git (private ops repo) + periodic encrypted snapshot:

- systemd units + drop-ins
- `/etc/appsolino-fusion/*`
- reverse proxy site configs
- firewall rules
- backup job configs (without raw secrets)
- monitoring dashboards/alerts as code

## 5. Releases

- Immutable artefact directories + SHA256 sums
- Manifest: Appsolino version, upstream base SHA, Appsolino source SHA, build time, Node/pnpm, lockfile hash, migration-set hash, schemaMax, bundle hashes
- Keep N previous **schema-compatible** releases for rollback

## 6. Full-server recovery procedure

1. Provision Ubuntu 24.04 (Terraform/cloud-init)
2. Run Ansible playbook (users, sudo, packages, dirs, units)
3. Install pinned Node/pnpm toolchain
4. Restore secrets to `/etc/appsolino-fusion` (manual/offline step)
5. Fetch release artefact by ID (not “latest source”)
6. Install to `/opt/appsolino-fusion/releases/<id>`; activate
7. Restore Postgres to target RPO point; verify schema vs manifest schemaMax
8. Configure DNS/reverse proxy
9. Start service; readiness must pass identity/schema gates
10. Run acceptance smoke (health, CLI task list, one staging-like dry task if policy allows)
11. Confirm backup job + monitoring agent
12. Document recovery drill result

## 7. Scheduled restore tests

| Drill | Frequency | Pass criteria |
| --- | --- | --- |
| Logical dump restore to scratch DB | Weekly | Schema matches; Fusion readiness against scratch |
| Artefact reactivation on Host B | Weekly | Identity gate green |
| Full Host P rebuild from scratch | Quarterly | RTO met; no production secrets on build host |

Failure of any drill = P0 ops incident (ISS-OPS-003).

## 8. Failure → component → evidence

| Failure | Component | Evidence |
| --- | --- | --- |
| Lost VPS | Ansible + artefact + PG restore | Quarterly drill |
| Bad migration | Pre-migration backup + lease | Staging migrate test |
| Ransomware on host | Append-only off-host backups | Delete attempt test from Fusion creds fails |
| Secret loss | Offline master key | Dual custody restore |
| GitHub unavailable | Local artefact cache + mirrored release store | Offline activate test |
