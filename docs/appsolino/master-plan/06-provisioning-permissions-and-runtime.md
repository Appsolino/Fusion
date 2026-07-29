# Provisioning, Permissions, and Runtime

Last updated: 2026-07-29

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

- Passwordless sudo required (accepted).
- Preflight must verify `sudo -n true` succeeds.
- Agents must never block on sudo password.
- Recoverability > interactive restriction: immutable releases, protected GitHub branches, append-only backups, activation authority, monitoring of unit/firewall/symlink changes.

## 4. systemd runtime posture (production)

Retain proven safeguards from current host, cleaned up:

- `User=fusion` / `Group=fusion`
- `ProtectSystem=strict` + explicit `ReadWritePaths` for `/srv/appsolino-fusion` and `/run/appsolino-fusion`
- `ProtectHome=yes`
- `NoNewPrivileges=yes` on the **service** unit does **not** remove the separate sudoers capability of the `fusion` user for agent shells — document this split clearly
- `UMask=0027`
- `NODE_OPTIONS=--max-old-space-size` sized per tier
- ExecStart always via `fusion-env` → `/opt/appsolino-fusion/current/.../packages/cli/dist/bin.js`
- **Never** ExecStart into a source checkout

Drop-in precedence lesson from today: `zzz-fusion-env-exec.conf` overrides base unit pointing at `source/fusion-appsolino` — rebuild must eliminate the stale base path entirely.

## 5. Staging isolation (already partially present)

Current `fusion-staging.service` pattern to preserve conceptually:

- Separate user `fusion-staging`
- Separate HOME/state
- Port `4041`
- No production tokens/GitHub deploy secrets
- Separate current symlink (`current/fusion-staging`)

## 6. Sandbox / container strategy

| Layer | Choice |
| --- | --- |
| Host service | systemd (not container) |
| Task commands | bubblewrap backend (`sandbox.backend=bubblewrap`) |
| failureMode | `fail-hard` in production once proven; `fallback-native` only in early soak with alert |
| Docker | Optional disposable workers / CI; not default task path for Tier 1–2 |
| Rootless containers | Reconsider at Tier 3 |
| Ephemeral VM workers | Out of scope until multi-tenant isolation required |

## 7. Package store and worktree prep

Provisioning must place:

- `install-task-worktree-deps` semantics as first-class script under `/usr/local/libexec/appsolino-fusion/`
- Private pnpm store roots under `/srv/appsolino-fusion/cache/pnpm/<scope>`
- Environment contract file (successor to `.fusion/environment.yml` host defaults)

## 8. Rebuild smoke checklist (post-provision)

1. `sudo -n true` as fusion
2. `bwrap --ro-bind / / --tmpfs /tmp true` (or fusion doctor equivalent)
3. Writable paths under `/srv/appsolino-fusion`
4. Release paths immutable
5. `fusion-env` health against staged release
6. Postgres connectivity
7. Backup job dry-run
8. No unexpected root-owned files in mutable paths

## 9. Failure prevented → component → evidence

| Failure | Component | Evidence |
| --- | --- | --- |
| EROFS dep install | systemd ReadWritePaths + Ansible | Env acceptance test |
| Interactive sudo hang | sudoers | `sudo -n` preflight |
| Root contamination | ownership + detector | cron alert + repair |
| Shared store chmod | private pnpm stores | worktree prep test |
| Source-run production | ExecStart + immutable `/opt` | identity readiness |
