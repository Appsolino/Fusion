# Phase 1 — Build and packaging results

## Toolchain

- Node: `v22.23.1`
- Corepack: `0.34.6`
- pnpm: `10.33.0`
- Bun: candidate-local install under isolated HOME (Phase 1B / closure)

## Accepted Phase 1B sequence

1. Frozen lockfile install — PASS
2. Focused version tests — PASS (CLI 6/6, dashboard 7/7)
3. `build:full` — PASS
4. `build:exe` — PASS
5. Rebuild after Bun `--define` direct-access fix — PASS

## Accepted executable identity (Phase 1B)

- Path (build tree): `packages/cli/dist/fn`
- Size: ~113 MiB
- sha256: `79ec7c2b095330ff2db2e5028f419c96caaf711ceb9a0b3afab8f5a5a603c141`
- Build log: `Embedding CLI version identity: 0.74.0-beta.5`

## Closure integration verification

Product commit: `82feb14b732dcd31176338d024b09e68c1646808`

| Step | Result |
|------|--------|
| Focused CLI version tests (6) | PASS |
| Focused dashboard version tests (7) | PASS |
| Frozen install | PASS |
| `build:full` | PASS |
| `build:exe` (Embedding CLI version identity: `0.74.0-beta.5`) | PASS |
| Isolated `fn --version` | `0.74.0-beta.5` |
| Packaged `/api/health` | `0.74.0-beta.5` |
| Controlled candidate restart | PASS |

Integrated executable sha256 differs from Phase 1B bytes (product-branch client stamp/paths) while **version identity** matches the accepted result.
