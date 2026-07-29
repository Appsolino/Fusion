# Upstream contribution draft (DO NOT PUBLISH YET)

## Title

`fix(cli): embed version identity in standalone Bun executable`

## Observed failure

On upstream `b85a5d4531df8fa749d77bf85ea4ab9ab960ce86` (`0.74.0-beta.5`):

- `packages/cli/dist/fn --version` prints `unknown`
- dashboard `/api/health` reports `"version":"0.0.0"`

All other packaged-runtime smoke gates passed.

## Reproduction

1. Checkout upstream SHA above.
2. `pnpm install --frozen-lockfile`
3. `pnpm build:full && pnpm --filter @runfusion/fusion build:exe`
4. Copy `packages/cli/dist/fn` (plus staged `client/`, `migrations/`, `runtime/`) to an isolated directory.
5. From an unrelated cwd, with `npm_package_version` unset, run `./fn --version` → `unknown`.
6. Start dashboard and GET `/api/health` → `0.0.0`.

## Root cause

CLI/dashboard version resolution walks ancestors of `import.meta.url` for `@runfusion/fusion`'s `package.json`. Inside a `bun --compile` binary, `import.meta.url` lives under `/$bunfs`, so that discovery fails. The executable build stages assets but does not embed an authoritative version.

## Minimal fix

1. Read and validate `packages/cli/package.json` version at `build:exe` time.
2. Inject it with Bun `--define process.env.FUSION_EMBEDDED_CLI_VERSION=...`.
3. Prefer that value in CLI `--version` and the shared dashboard resolver.
4. Fail the executable build on missing/invalid/placeholder versions.
5. Keep source/npm discovery for non-compiled layouts.

## Tests

- Manifest load/validation unit tests
- Embedded-vs-source resolver unit tests
- Packaged executable version + health identity after relocating the binary

## Why runtime package-manifest discovery is insufficient

A standalone Bun executable is intentionally self-contained. Its module URL is virtualized (`/$bunfs`). Requiring a nearby checkout or adjacent `package.json` reintroduces packaging fragility and breaks as soon as the binary is moved. Compile-time identity is the correct contract for release executables.

## Publication status

**Not published** to Runfusion/Fusion. Draft retained for a later upstream contribution after Appsolino review.
