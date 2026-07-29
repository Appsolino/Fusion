import { existsSync, readFileSync } from "node:fs";

/**
 * FNXC:StandaloneExeVersionIdentity 2026-07-29:
 * Standalone `bun --compile` binaries resolve `import.meta.url` inside Bun's
 * virtual filesystem (`/$bunfs/...`). Ancestor walks for `@runfusion/fusion`'s
 * package.json therefore fail, and `--version` / dashboard health fall back to
 * `unknown` / `0.0.0`. Build-time embedding via
 * `process.env.FUSION_EMBEDDED_CLI_VERSION` is the authoritative fix.
 */

export const CLI_PACKAGE_NAME = "@runfusion/fusion";

/** Semver core plus optional prerelease/build, matching published Fusion versions. */
export const CLI_RELEASE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const EMBEDDED_CLI_VERSION_ENV = "FUSION_EMBEDDED_CLI_VERSION";

export function validateCliReleaseVersion(version: unknown, sourceLabel = "CLI package version"): string {
  if (typeof version !== "string") {
    throw new Error(`${sourceLabel} must be a non-empty string`);
  }
  const trimmed = version.trim();
  if (trimmed.length === 0) {
    throw new Error(`${sourceLabel} must be a non-empty string`);
  }
  if (trimmed === "unknown" || trimmed === "0.0.0") {
    throw new Error(`${sourceLabel} must not be a placeholder fallback (${trimmed})`);
  }
  if (!CLI_RELEASE_VERSION_RE.test(trimmed)) {
    throw new Error(`${sourceLabel} is not a valid release version: ${JSON.stringify(version)}`);
  }
  return trimmed;
}

export function loadCliReleaseVersionFromManifest(packageJsonPath: string): string {
  if (!existsSync(packageJsonPath)) {
    throw new Error(`CLI package manifest not found: ${packageJsonPath}`);
  }
  let parsed: { name?: unknown; version?: unknown };
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      name?: unknown;
      version?: unknown;
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`CLI package manifest is unreadable at ${packageJsonPath}: ${message}`);
  }
  if (parsed.name !== CLI_PACKAGE_NAME) {
    throw new Error(
      `CLI package manifest at ${packageJsonPath} must declare name ${CLI_PACKAGE_NAME} (got ${JSON.stringify(parsed.name)})`,
    );
  }
  return validateCliReleaseVersion(parsed.version, `CLI package version in ${packageJsonPath}`);
}

/**
 * Returns the compile-time embedded CLI version when Bun `--define` replaced
 * `process.env.FUSION_EMBEDDED_CLI_VERSION`, or when the env var is set in tests.
 * Unset / empty values mean "not embedded" so source mode can fall back to
 * package-manifest discovery.
 *
 * Direct `process.env.FUSION_EMBEDDED_CLI_VERSION` access is required for Bun
 * compile-time `--define` replacement. Dynamic `env[key]` lookups are not rewritten.
 */
export function readEmbeddedCliVersion(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string | undefined {
  if (env) {
    const raw = env[EMBEDDED_CLI_VERSION_ENV];
    if (typeof raw !== "string") {
      return undefined;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    return trimmed;
  }

  const embedded = process.env.FUSION_EMBEDDED_CLI_VERSION;
  if (typeof embedded === "string" && embedded.trim().length > 0) {
    return embedded.trim();
  }
  return undefined;
}
