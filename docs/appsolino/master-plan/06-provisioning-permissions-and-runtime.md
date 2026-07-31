> **Status: Historical/reference**
> This document does not override `MASTER-PLAN.md`, `OPERATING-MODEL.md` or `CURRENT-STATE.md`.

# Provisioning, Permissions, and Runtime

Last updated: 2026-07-29
Status: Corrected after Phase 0 technical review (full-admin service model).

## 1. Provisioning approach

### Recommendation: **cloud-init + Ansible**

| Tool | Role |
| --- | --- |
| Terraform (optional) | Create VPS + firewall security groups + attach volumes |
| cloud-init | First boot: users, SSH keys, base packages, Ansible bootstrap |
| Ansible | Idempotent Fusion host configuration (authoritative) |
| Shell scripts alone | Rejected as sole system — drift-prone |
| Packer images | Optional later for faster rebuilds; not required initially |
| Container images | For CI/build workers; not the production Fusion service |

**Why Ansible:** matches destroy/rebuild goal, encodes ownership/systemd/backup/firewall, works with full-admin model without baking secrets into images.

## 2. What provisioning must install/configure

- User `fusion` (+ `fusion-staging` on Host B)
- Groups: `fusion`, `fusion-developers`, `docker` (if enabled)
- `fusion ALL=(ALL) NOPASSWD: ALL` (and staging equivalent)
- Git, GitHub CLI, Node (pinned version recorded in inventory), Corepack, pinned pnpm
- build-essential, Python 3, PostgreSQL client
- bubblewrap; Docker only if policy enables disposable workers
- reverse proxy (Caddy or nginx) + certificates on edge if needed
- Directory tree + ownership from `05-server-architecture…`
- systemd units for Fusion, staging, backup, health, mirror (as applicable)
- monitoring agent (OTel collector / node exporter)
- backup jobs + logrotate
- firewall (default deny inbound except SSH from admin CIDR + localhost services)
- SSH hardening (no password auth)
- chrony/NTP
- unattended-upgrades for security patches with reboot window policy

## 3. Sudo and interactive prompts

- Passwordless sudo required (accepted): `fusion ALL=(ALL) NOPASSWD: ALL`.
- Agents must never block on interactive sudo prompts.
- **Critical (Phase 0 review):** `NOPASSWD` only removes the password check. It does **not** override kernel `no_new_privs`. If `fusion.service` sets `NoNewPrivileges=yes`, agent children inherit the flag and **cannot** elevate via `sudo`/`setuid` on `execve()`.
- Therefore production `fusion.service` must use `NoNewPrivileges=no` under the approved direct full-admin model.
- Preflight and acceptance must prove sudo works on the **Fusion service → engine → agent** path (ACC-ENV-03+), not only an SSH login shell as `fusion`.
- Recoverability controls remain: immutable releases, protected GitHub branches, append-only backups, activation authority, monitoring of unit/firewall/symlink changes.

## 4. systemd runtime posture (production) — approved full-admin model

Target production unit (dedicated disposable Fusion host):

```ini
User=fusion
Group=fusion
NoNewPrivileges=no
ProtectSystem=off
UMask=0027
```

Optional hardening that may remain **only if** acceptance tests prove required agent host-admin actions still succeed:

```ini
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
PrivateDevices=yes
```

### Explicitly rejected for this product model

| Setting | Why rejected |
| --- | --- |
| `NoNewPrivileges=yes` | Inherited by agent children; blocks `sudo` privilege elevation despite `NOPASSWD` |
| `ProtectSystem=strict` (with narrow `ReadWritePaths`) | Makes host hierarchy read-only in the service namespace; blocks approved `/etc`, `/usr`, `/opt`, firewall, and release-activation work |

**Rejected alternative:** keep `NoNewPrivileges=yes` + `ProtectSystem=strict` and route privileges through an external root broker. That adds another execution subsystem and conflicts with the accepted direct full-admin model.

### Other service rules

- `NODE_OPTIONS=--max-old-space-size` sized per tier
- ExecStart always via `fusion-env` → `/opt/appsolino-fusion/current/.../packages/cli/dist/bin.js`
- **Never** ExecStart into a source checkout
- Drop-in precedence lesson: eliminate stale base-unit paths that point at source checkouts

### Historical note (current live host)

Today’s surgical host still uses `ProtectSystem=strict` + broad `ReadWritePaths` and related drop-ins. That is **current degraded production**, not the approved rebuild target. Phase 2 provisioning must install the approved unit above; do not copy the contradictory strict+NOPASSWD combination forward.

## 5. Staging isolation (already partially present)

Current `fusion-staging.service` pattern to preserve conceptually:

- Separate user `fusion-staging`
- Separate HOME/state
- Port `4041`
- No production tokens/GitHub deploy secrets
- Separate current symlink (`current/fusion-staging`)
- Same `NoNewPrivileges=no` / `ProtectSystem=off` posture if staging agents must exercise host-admin acceptance tests

## 6. Sandbox / container strategy — two execution modes

| Mode | Mechanism | Purpose |
| --- | --- | --- |
| Ordinary task commands | bubblewrap (`sandbox.backend=bubblewrap`) | Isolate project/worktree commands; must not unintentionally modify host paths |
| Host-administration | Explicit **host-admin execution mode outside bubblewrap** | Approved OS package, systemd, firewall, `/etc/appsolino-fusion`, release-activation operations with sudo + audit |

- Default task path: bubblewrap; `failureMode=fail-hard` in production once proven
- Host-admin mode: not bubblewrap-contained; requires typed/approved action class + audit record (ACC-ENV-08)
- Docker: optional disposable workers / CI; not default task path for Tier 1–2

Without a defined host-admin mode, an agent may remain trapped in the task sandbox even when the approved policy allows host changes.

## 7. Package store and worktree prep

Provisioning must place:

- `install-task-worktree-deps` semantics as first-class script under `/usr/local/libexec/appsolino-fusion/`
- Private pnpm store roots under `/srv/appsolino-fusion/cache/pnpm/<scope>`
- Environment contract file (successor to `.fusion/environment.yml` host defaults)

## 8. Rebuild smoke checklist (post-provision)

1. ACC-ENV-03: Fusion-spawned agent `sudo -n id -u` → `0`
2. Bubblewrap ordinary task cannot write host paths (ACC-ENV-07)
3. Host-admin mode can write approved `/etc/appsolino-fusion` test file (ACC-ENV-05)
4. Writable paths under `/srv/appsolino-fusion` for routine work
5. Release paths immutable after activate
6. `fusion-env` health against staged release
7. Postgres connectivity
8. Backup job dry-run
9. No unexpected root-owned files in mutable paths

## 9. Failure prevented → component → evidence

| Failure | Component | Evidence |
| --- | --- | --- |
| Agent sudo blocked by `no_new_privs` | `NoNewPrivileges=no` on fusion.service | ACC-ENV-03 via service→agent path |
| Host FS read-only under strict protect | `ProtectSystem=off` | ACC-ENV-04/05/06 |
| Ordinary task escapes to host | bubblewrap default | ACC-ENV-07 |
| Host-admin without audit | host-admin mode | ACC-ENV-08 |
| Interactive sudo hang | sudoers NOPASSWD | ACC-ENV-03 |
| Root contamination | ownership + detector | cron alert + repair |
| Shared store chmod | private pnpm stores | worktree prep test |
| Source-run production | ExecStart + immutable `/opt` | identity readiness |
