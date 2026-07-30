# Host D before-state (Phase 2A)

See sanitised capture: `evidence/01-host-before-state.txt`.

Summary at mission start:

- Ubuntu 24.04.4 LTS, 6 vCPU, ~11 GiB RAM, 16 GiB swap, ~162–174 GiB free
- Node v22.23.1, Corepack 0.34.6, pnpm 10.33.0, PostgreSQL 16.14
- User `fusion` with NOPASSWD sudo
- UFW deny-in / allow-out; SSH 22 only public
- PostgreSQL listen localhost only; existing Phase 1 candidate DBs only
- No `fusion*.service` units installed
- `kernel.apparmor_restrict_unprivileged_userns=0`; bubblewrap present
- `/opt/appsolino-fusion/releases` empty placeholder; no production paths
