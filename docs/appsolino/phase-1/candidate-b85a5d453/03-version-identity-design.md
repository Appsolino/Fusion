# Phase 1B — Version Identity Design

## Approach

Compile-time embedding via Bun `--define`:

```text
process.env.FUSION_EMBEDDED_CLI_VERSION=<validated version from packages/cli/package.json>
```

## Shared resolver behaviour

1. Prefer embedded compile-time identity (direct `process.env.FUSION_EMBEDDED_CLI_VERSION` member access so Bun can rewrite it).
2. Else discover `@runfusion/fusion` package.json (source/npm layouts).
3. Else `npm_package_version`.
4. Else `0.0.0` / CLI `unknown` (source/dev only).

## Build fail-closed rule

`packages/cli/build.ts` calls `loadCliReleaseVersionFromManifest` before compile. Missing/empty/invalid/placeholder versions abort the executable build.

## Why not copy package.json beside the binary

Ancestor discovery is fragile under `/$bunfs` and after relocating the binary. Compile-time identity is deterministic regardless of cwd, checkout presence, or env vars.

## Bun constraint discovered during requalification

`--define process.env.FUSION_EMBEDDED_CLI_VERSION=...` only rewrites **direct** member expressions. Dynamic `env[key]` lookups are not replaced. The shared resolver therefore uses a direct member expression on the no-arg path.
