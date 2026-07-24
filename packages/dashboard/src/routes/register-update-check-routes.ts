import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getManagedSourcePublicMetadata, isManagedSourceMode, resolveGlobalDir } from "@fusion/core";
import { clearUpdateCheckCache, performUpdateCheck, performUpdateInstall } from "../update-check.js";
import { getCliPackageVersion, resolveCliPackageVersionInfo } from "../cli-package-version.js";
import type { ApiRouteRegistrar } from "./types.js";

function resolveFusionReleaseRoot(importMetaUrl: string): string | undefined {
  const startDir = dirname(fileURLToPath(importMetaUrl));
  const versionInfo = resolveCliPackageVersionInfo(startDir);
  return versionInfo ? dirname(versionInfo.packageJsonPath) : undefined;
}

export const registerUpdateCheckRoutes: ApiRouteRegistrar = (ctx) => {
  const { router, store, rethrowAsApiError } = ctx;
  const cliPackageVersion = getCliPackageVersion(import.meta.url);
  const releaseRoot = resolveFusionReleaseRoot(import.meta.url);

  const buildManagedStatusPayload = () => {
    const metadata = getManagedSourcePublicMetadata(releaseRoot);
    return {
      managed: true,
      managedMessage: metadata.managedMessage,
      statusPath: metadata.statusPath,
      status: metadata.status,
      provenance: metadata.provenance,
      currentVersion: cliPackageVersion,
      updateAvailable: false,
      latestVersion: null,
      lastChecked: Date.now(),
    };
  };

  router.get("/managed-source/status", (_req, res) => {
    try {
      if (!isManagedSourceMode()) {
        res.json({ managed: false });
        return;
      }
      res.json(buildManagedStatusPayload());
    } catch (error) {
      rethrowAsApiError(error, "Failed to read managed source status");
    }
  });

  router.get("/update-check", async (_req, res) => {
    try {
      if (isManagedSourceMode()) {
        res.json(
          await performUpdateCheck(resolveGlobalDir(), cliPackageVersion, {
            channel: (await store.getGlobalSettingsStore().getSettings()).updateChannel,
            releaseRoot,
          }),
        );
        return;
      }

      const globalSettings = await store.getGlobalSettingsStore().getSettings();
      if (globalSettings.updateCheckEnabled === false) {
        res.json({
          updateAvailable: false,
          disabled: true,
          currentVersion: cliPackageVersion,
          latestVersion: null,
          lastChecked: Date.now(),
        });
        return;
      }

      const result = await performUpdateCheck(resolveGlobalDir(), cliPackageVersion, {
        frequency: globalSettings.updateCheckFrequency,
        channel: globalSettings.updateChannel,
        releaseRoot,
      });
      res.json(result);
    } catch (error) {
      rethrowAsApiError(error, "Failed to perform update check");
    }
  });

  router.post("/update-check/refresh", async (_req, res) => {
    try {
      const globalSettings = await store.getGlobalSettingsStore().getSettings();
      const fusionDir = resolveGlobalDir();
      if (!isManagedSourceMode()) {
        await clearUpdateCheckCache(fusionDir);
      }
      // Explicit `force: true` so a "manual" frequency setting doesn't short
      // out the network fetch on the user's deliberate "Check now" click.
      const result = await performUpdateCheck(fusionDir, cliPackageVersion, {
        force: true,
        channel: globalSettings.updateChannel,
        releaseRoot,
      });
      res.json(result);
    } catch (error) {
      rethrowAsApiError(error, "Failed to refresh update check");
    }
  });

  router.post("/update-check/install", async (_req, res) => {
    try {
      if (isManagedSourceMode()) {
        const metadata = getManagedSourcePublicMetadata(releaseRoot);
        res.status(409).json({
          currentVersion: cliPackageVersion,
          latestVersion: null,
          updated: false,
          managed: true,
          error: metadata.managedMessage,
          statusPath: metadata.statusPath,
        });
        return;
      }

      const globalSettings = await store.getGlobalSettingsStore().getSettings();
      const fusionDir = resolveGlobalDir();
      const updateCheck = await performUpdateCheck(fusionDir, cliPackageVersion, {
        force: true,
        channel: globalSettings.updateChannel,
        releaseRoot,
      });

      if (!updateCheck.updateAvailable || !updateCheck.latestVersion) {
        res.json({
          currentVersion: updateCheck.currentVersion,
          latestVersion: updateCheck.latestVersion,
          updated: false,
        });
        return;
      }

      const result = await performUpdateInstall(updateCheck.currentVersion, updateCheck.latestVersion, { fusionDir });
      res.json(result);
    } catch (error) {
      rethrowAsApiError(error, "Failed to install update");
    }
  });
};
