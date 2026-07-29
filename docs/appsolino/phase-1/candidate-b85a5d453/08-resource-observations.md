# Phase 1 — Resource observations (Host D / staging-lite)

Host class: Contabo VPS, Ubuntu 24.04.4 LTS, 6 vCPU, ~11 GiB RAM, 200 GB SSD, 16G swap.

## Observations during Phase 1B `build:full`

- Peak RAM approached ~11 GiB used with brief free memory dips; swap rose to ~1.0 GiB; no thrashing halt.
- Disk free remained ample (~165 GiB class).
- One build at a time; no agents; no concurrent soak.
- Non-blocking host warning: Contabo `cloud-init.service` bootcmd failure (recorded only).

## Closure note

Integrated verification reused the private Phase 1 pnpm store and isolated Bun HOME. No production resources were used.
