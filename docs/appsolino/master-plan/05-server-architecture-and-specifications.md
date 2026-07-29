# Server Architecture and Specifications

Last updated: 2026-07-29
**Label:** Appsolino operational recommendations — **not** official Fusion requirements.
Measurements required later are listed at the end of each tier.

## 1. Architecture decision

### Recommended

**Hybrid host model on Ubuntu Server 24.04 LTS:**

- Fusion **dashboard/engine under systemd** as user `fusion`
- Task command isolation via **bubblewrap** (upstream-supported; `docs/sandbox.md`)
- **Immutable releases** on local disk; mutable state under `/srv/appsolino-fusion`
- **External or independently managed PostgreSQL** for production
  - **Current host fact:** production today uses **embedded Postgres** under `state/fusion-production/.fusion/embedded-postgres/default` (~port 35503). Phase 2 must migrate off embedded for long-term prod (`OD-PG`).
- **Two VPS topology to start:**
  - **Host P (production):** Env C only
  - **Host B (build+staging):** Env A + Env B

### Rejected as primary

| Alternative | Why rejected |
| --- | --- |
| Fusion primarily inside Docker on production | Git worktrees, passwordless sudo, systemd identity, bubblewrap user namespaces, and host path contracts fight the container boundary; upstream Dockerfile is better for CI/disposable workers |
| Single powerful box for build+stage+prod | Violates “no compile on production”; shared DB risk; current 96G disk already 60% used on today’s host |
| Three VPS from day one | Valid later; unnecessary cost until staging contention proven |
| Embedded Postgres as long-term production DB | Backup/identity ambiguity already observed; harder off-host DR |
| Full VM-per-agent | Excessive burden for Tier 1–2 |

### Reasoning summary

| Concern | Hybrid systemd+bwrap | Docker-primary |
| --- | --- | --- |
| Worktree compatibility | Strong | Weak without complex mounts |
| Unrestricted sudo model | Natural on host | Contradicts container least-privilege story |
| Reproducible builds | On Host B | Good in CI images |
| Migration safety | External PG + gates | Possible but ops-heavy |
| Recovery | Rebuild host from Ansible + restore PG | Image+volume restore |
| Maintenance burden | Medium | Medium–high for worktree platform |

## 2. Environment topology

| Env | Role | Host | DB | Credentials |
| --- | --- | --- | --- | --- |
| A Build/research | Clean clones, upstream compare, full builds/tests | **Host B** | None / ephemeral | No prod secrets |
| B Staging/acceptance | Exact packaged artefact; chaos/migration tests | **Host B** | Separate staging Postgres (same major/class as prod) | Staging-only |
| C Production | Immutable release; no compile | **Host P** | **Managed external PostgreSQL** | Narrow scoped |

**Approved (Phase 0):** two-host start. Split Host B later only if measurements justify it.

### Approved initial host specifications

**Host B — Build and staging**

```text
Ubuntu Server 24.04 LTS
16 vCPU
64 GB RAM
500 GB NVMe
16–32 GB swap
```

**Host P — Production**

```text
Ubuntu Server 24.04 LTS
8–16 vCPU
32–64 GB RAM
500 GB NVMe
16 GB swap
```

Current host evidence (2026-07-29): single machine already has `fusion.service`, `fusion-staging.service` (port 4041, crash-loop), and automation timers — co-location exists today and must be **split** in the rebuild. Production uses **embedded** Postgres today; Phase 2 migrates Host P to managed external PG.

## 3. Server sizing tiers (Appsolino recommendation)

Assumptions: Node builds, pnpm workspaces, Vitest, tsc, multiple git worktrees, clean-room merge trees, Postgres client or local PG on build host, logs/artifacts, concurrent model agents, optional Docker.

### Tier 1 — 1–2 concurrent agents

| Resource | Recommendation |
| --- | --- |
| vCPU | 4–6 |
| RAM | 16 GiB |
| NVMe | 200 GB |
| Swap | 4 GiB (emergency only) |
| Network | 1 Gbps class |
| PostgreSQL | External small instance OR local on Host B only |
| Build concurrency | 2 |
| Max agent concurrency | 2 |
| Max test concurrency | 2–4 |
| Worktree capacity | ~10–20 active |

**Must measure later:** peak RSS per agent session; Vitest RSS; worktree disk growth/day.

### Tier 2 — 3–6 concurrent agents

| Resource | Recommendation |
| --- | --- |
| vCPU | 8–12 |
| RAM | 32–48 GiB |
| NVMe | 500 GB |
| Swap | 8 GiB |
| Network | 1–2 Gbps |
| PostgreSQL | External (separate CPU/IO) |
| Build concurrency | 4 (Host B) |
| Max agent concurrency | 6 |
| Max test concurrency | 4–6 |
| Worktree capacity | ~40–60 |

### Tier 3 — 7–12 concurrent agents

| Resource | Recommendation |
| --- | --- |
| vCPU | 16–24 |
| RAM | 64–96 GiB |
| NVMe | 1 TB+ |
| Swap | 8–16 GiB |
| Network | 2 Gbps+ |
| PostgreSQL | Managed / dedicated host |
| Build concurrency | dedicated Host B/S split recommended |
| Max agent concurrency | 12 |
| Max test concurrency | 8 (isolated from agents) |
| Worktree capacity | ~100+ with aggressive GC |

**Current observed host:** 6 vCPU / ~11 GiB / 96 GB disk — suitable at most for Tier 1 production **without** heavy builds; do not treat as Tier 2 capacity.

## 4. Filesystem layout (target)

```text
/opt/appsolino-fusion/
  releases/<release-id>/          # immutable after activate
  current -> releases/<release-id>

/etc/appsolino-fusion/
  fusion.env
  server-policy.json
  backup-policy.json

/srv/appsolino-fusion/
  source/                         # Host B only clones
  build/
  state/                          # FUSION_HOME equivalents
  workspaces/
  worktrees/
  cache/pnpm/
  artifacts/
  logs/
  tmp/

/run/appsolino-fusion/
  locks/
```

Migration note: today’s `/srv/software-factory/...` remains evidence; rebuild should cut over to the cleaner namespace rather than forever encoding “software-factory” into product identity.

### Ownership / modes (routine paths must not need sudo)

| Path | Owner | Mode | Runtime mutable? | Backup? |
| --- | --- | --- | --- | --- |
| `/opt/.../releases/<id>` | root:fusion | `755` dirs, files `644`; dir immutable flag after activate | No | Artefact store + GitHub tag |
| `/opt/.../current` | root:fusion | symlink | Via activator only | Record in manifest |
| `/etc/appsolino-fusion` | root:fusion | `750`; secrets `640` | Controlled | Yes |
| `/srv/.../state` | fusion:fusion | `750` | Yes | Selective (not all caches) |
| `/srv/.../workspaces` | fusion:fusion | `775` + sticky as needed | Yes | No (rebuildable) |
| `/srv/.../worktrees` | fusion:fusion | `775` | Yes disposable | No |
| `/srv/.../cache/pnpm` | fusion:fusion | `750` private stores | Yes disposable | No |
| `/srv/.../logs` | fusion:fusion | `750` | Yes | Short retention + ship to Loki |
| `/run/.../locks` | fusion:fusion | `770` | Yes | No |

Default umask: `0027`.

**Immutable at runtime:** release directories.
**Agents may modify:** state, workspaces, worktrees, cache, logs, tmp.
**Deployment owns:** `/opt` releases, `/etc` policy, systemd units.
**Disposable:** worktrees, tmp, pnpm caches, build trees.
**Backup required:** Postgres, secrets, `/etc`, release manifests, provisioning code, GitHub.

### pnpm store strategy

| Option | Decision |
| --- | --- |
| Shared mutable store across uids | **Reject** |
| Private store per build/release | **Prefer** |
| Shared read-only content store | Optional later optimisation |
| `package-import-method=copy` | **Prefer** for worktree materialisation reliability |
| Reflinks | Use when filesystem supports; fallback copy |
| Isolated stores per task | Allowed for Tier 2+ if disk allows |
| Prebuilt dependency layers | Host B build cache only |

### Root-owned contamination

- Detector cron: find root-owned under `/srv/appsolino-fusion/{workspaces,worktrees,cache,state}`
- Auto-repair: `chown -R fusion:fusion` for known disposable paths only
- Never auto-chown `/opt/releases` or `/etc`

## 5. Network and trust boundaries

**Inside dedicated Fusion host:** unrestricted admin for `fusion` (accepted).

**Outside:**

| Resource | Fusion host access |
| --- | --- |
| Unrelated servers | None |
| Unrelated GitHub repos | None — fine-grained PAT / GitHub App limited to Appsolino/Fusion (+ staging vault) |
| Org-wide cloud admin | None |
| VPS provider account | None from host |
| Domain registrar | None |
| Unrelated prod DBs | None |
| Off-host backups | Write-only / append-only credentials; **no delete** |

## 6. Full-admin action classes

| Action | Class |
| --- | --- |
| Package install, ownership repair, cache repair, service restart | Autonomous |
| Firewall changes | Autonomous + alert |
| Systemd unit edits | Autonomous + alert + config backup |
| Staging release activate / staging migrate | Autonomous after checks |
| Production release activate / migrate | After automated validation; **human confirm if `OD-ACTIVATE-AUTH` requires** |
| Backup policy / destination change | Human only; separate credentials |
| Off-host backup delete | Impossible with Fusion credentials |

## 7. Compatibility notes

- **Git worktrees:** first-class on host filesystem — primary reason to reject Docker-primary.
- **Sudo:** NOPASSWD on Host P/B for `fusion` / build users as designed.
- **Reproduce builds:** only on Host B from pinned SHA + lockfile hash.
- **Migration safety:** external PG + exclusive lease + pre-backup.
- **Maintenance:** Ansible provisioning + release controller; fewer one-off surgical scripts.
