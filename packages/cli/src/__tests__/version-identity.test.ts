// @vitest-environment node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLI_PACKAGE_NAME,
  EMBEDDED_CLI_VERSION_ENV,
  loadCliReleaseVersionFromManifest,
  readEmbeddedCliVersion,
  validateCliReleaseVersion,
} from "../version-identity.js";

describe("version-identity", () => {
  it("reads and validates 0.74.0-beta.5 from the CLI manifest", () => {
    const packageJsonPath = join(import.meta.dirname, "..", "..", "package.json");
    expect(loadCliReleaseVersionFromManifest(packageJsonPath)).toBe("0.74.0-beta.5");
  });

  it("fails when the CLI manifest is missing", () => {
    expect(() => loadCliReleaseVersionFromManifest(join(tmpdir(), "missing-fusion-package.json"))).toThrow(
      /CLI package manifest not found/,
    );
  });

  it("fails when the CLI manifest version is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-version-missing-"));
    try {
      const packageJsonPath = join(root, "package.json");
      writeFileSync(packageJsonPath, JSON.stringify({ name: CLI_PACKAGE_NAME }, null, 2));
      expect(() => loadCliReleaseVersionFromManifest(packageJsonPath)).toThrow(/non-empty string/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when the CLI manifest version is empty or invalid", () => {
    expect(() => validateCliReleaseVersion("")).toThrow(/non-empty string/);
    expect(() => validateCliReleaseVersion("   ")).toThrow(/non-empty string/);
    expect(() => validateCliReleaseVersion("not-a-version")).toThrow(/not a valid release version/);
    expect(() => validateCliReleaseVersion("unknown")).toThrow(/placeholder fallback/);
    expect(() => validateCliReleaseVersion("0.0.0")).toThrow(/placeholder fallback/);
  });

  it("fails when the manifest name is not the published CLI package", () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-version-wrong-name-"));
    try {
      mkdirSync(root, { recursive: true });
      const packageJsonPath = join(root, "package.json");
      writeFileSync(packageJsonPath, JSON.stringify({ name: "@fusion/dashboard", version: "0.74.0-beta.5" }, null, 2));
      expect(() => loadCliReleaseVersionFromManifest(packageJsonPath)).toThrow(/must declare name/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads the embedded compile-time identity from the env define surface", () => {
    expect(readEmbeddedCliVersion({ [EMBEDDED_CLI_VERSION_ENV]: "0.74.0-beta.5" })).toBe("0.74.0-beta.5");
    expect(readEmbeddedCliVersion({ [EMBEDDED_CLI_VERSION_ENV]: "" })).toBeUndefined();
    expect(readEmbeddedCliVersion({})).toBeUndefined();
  });
});
