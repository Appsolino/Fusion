# Phase 1B — Root Cause

Date (UTC): 2026-07-29
Upstream base: `b85a5d4531df8fa749d77bf85ea4ab9ab960ce86`
Declared CLI version: `0.74.0-beta.5`

## Confirmed failure (Phase 1A)

1. `packages/cli/package.json` declares `0.74.0-beta.5`.
2. Packaged standalone `fn --version` returned `unknown`.
3. Packaged dashboard `/api/health` returned `version: 0.0.0`.
4. Reproduction outside the source checkout (isolated runtime copy, unrelated cwd, `npm_package_version` unset) still returned `unknown`.

## Resolution mechanism

- CLI early path (`packages/cli/src/bin.ts` `readOwnCliVersion`) walks ancestors of `import.meta.url` for a `package.json` named `@runfusion/fusion`.
- Dashboard path (`packages/dashboard/src/cli-package-version.ts` `getCliPackageVersion`) performs the same class of ancestor/sibling package-manifest discovery, then falls back to `npm_package_version`, then `0.0.0`.

## Why Bun compile breaks it

`packages/cli/build.ts` uses `bun build --compile` to emit a self-contained binary. At runtime, `import.meta.url` resolves inside Bun's virtual filesystem (`/$bunfs/...`). Ordinary filesystem ancestor walks therefore never find `packages/cli/package.json`. Bun compile also does not inject an authoritative Fusion version by default.

## Conclusion

Narrow upstream packaging defect: missing compile-time version identity for the standalone Bun executable.
