import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MANAGED_SOURCE_STATUS_PATH,
  getManagedSourcePublicMetadata,
  getManagedSourceRefusalMessage,
  getManagedSourceStatusPath,
  isManagedSourceMode,
  readAppsolinoReleaseProvenance,
  readManagedSourceStatus,
  resolveAppsolinoReleaseDisplayLabel,
} from "../managed-source.js";

describe("managed-source", () => {
  const originalManaged = process.env.FUSION_MANAGED_SOURCE;
  const originalStatusPath = process.env.FUSION_MANAGED_SOURCE_STATUS;

  afterEach(() => {
    if (originalManaged === undefined) {
      delete process.env.FUSION_MANAGED_SOURCE;
    } else {
      process.env.FUSION_MANAGED_SOURCE = originalManaged;
    }
    if (originalStatusPath === undefined) {
      delete process.env.FUSION_MANAGED_SOURCE_STATUS;
    } else {
      process.env.FUSION_MANAGED_SOURCE_STATUS = originalStatusPath;
    }
  });

  it("isManagedSourceMode is true only for appsolino", () => {
    delete process.env.FUSION_MANAGED_SOURCE;
    expect(isManagedSourceMode()).toBe(false);

    process.env.FUSION_MANAGED_SOURCE = "appsolino";
    expect(isManagedSourceMode()).toBe(true);

    process.env.FUSION_MANAGED_SOURCE = "other";
    expect(isManagedSourceMode()).toBe(false);
  });

  it("getManagedSourceStatusPath honors override env", () => {
    expect(getManagedSourceStatusPath()).toBe(DEFAULT_MANAGED_SOURCE_STATUS_PATH);
    process.env.FUSION_MANAGED_SOURCE_STATUS = "/tmp/custom-status.json";
    expect(getManagedSourceStatusPath()).toBe("/tmp/custom-status.json");
  });

  it("readManagedSourceStatus sanitizes known fields and redacts secrets", () => {
    const status = readManagedSourceStatus({
      statusPath: "/ignored.json",
      readFile: () =>
        JSON.stringify({
          deployedSha: "abc123",
          upstreamSha: "def456",
          token: "ghp_secretShouldNotAppear",
          nested: { ignored: true },
        }),
    });

    expect(status).toEqual({
      deployedSha: "abc123",
      upstreamSha: "def456",
    });
  });

  it("readAppsolinoReleaseProvenance reads either filename", () => {
    const provenance = readAppsolinoReleaseProvenance({
      releaseRoot: "/release",
      readFile: (path) => {
        if (path.endsWith("appsolino-release.json")) {
          return JSON.stringify({ stableSha: "sha-from-lowercase", upstreamVersion: "0.73.0" });
        }
        throw new Error("missing");
      },
    });

    expect(provenance).toEqual({ stableSha: "sha-from-lowercase", upstreamVersion: "0.73.0" });
  });

  it("getManagedSourcePublicMetadata aggregates status and provenance when managed", () => {
    process.env.FUSION_MANAGED_SOURCE = "appsolino";
    process.env.FUSION_MANAGED_SOURCE_STATUS = "/tmp/status.json";

    const metadata = getManagedSourcePublicMetadata("/release");
    expect(metadata.managedSource).toBe(true);
    expect(metadata.statusPath).toBe("/tmp/status.json");
    expect(metadata.managedMessage).toContain("Appsolino");
  });

  it("resolveAppsolinoReleaseDisplayLabel prefers stableSha", () => {
    const label = resolveAppsolinoReleaseDisplayLabel({
      status: { deployedSha: "deployed" },
      provenance: { stableSha: "stable-sha" },
    });
    expect(label).toBe("stable-sha");
  });

  it("getManagedSourceRefusalMessage includes status path", () => {
    process.env.FUSION_MANAGED_SOURCE_STATUS = "/tmp/status.json";
    expect(getManagedSourceRefusalMessage()).toContain("/tmp/status.json");
  });
});
