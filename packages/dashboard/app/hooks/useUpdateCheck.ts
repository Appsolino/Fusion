import { useCallback, useEffect, useState } from "react";
import { checkForUpdate } from "../api";
import type { ManagedSourceStatus } from "@fusion/core";

const UPDATE_BANNER_DISMISSED_KEY = "kb-update-banner-dismissed";
const MANAGED_SOURCE_BANNER_DISMISSED_KEY = "kb-managed-source-banner-dismissed";

export interface UseUpdateCheckResult {
  updateAvailable: boolean;
  latestVersion: string | null;
  currentVersion: string | null;
  loading: boolean;
  dismissed: boolean;
  dismiss: () => void;
  managedSource: boolean;
  managedMessage: string | null;
  managedStatus: ManagedSourceStatus | null;
  managedBannerDismissed: boolean;
  dismissManagedBanner: () => void;
}

export function useUpdateCheck(): UseUpdateCheckResult {
  const [loading, setLoading] = useState(true);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [managedSource, setManagedSource] = useState(false);
  const [managedMessage, setManagedMessage] = useState<string | null>(null);
  const [managedStatus, setManagedStatus] = useState<ManagedSourceStatus | null>(null);
  const [managedBannerDismissed, setManagedBannerDismissed] = useState(false);

  useEffect(() => {
    const isDismissed = sessionStorage.getItem(UPDATE_BANNER_DISMISSED_KEY) === "true";
    setDismissed(isDismissed);
    const managedDismissed = sessionStorage.getItem(MANAGED_SOURCE_BANNER_DISMISSED_KEY) === "true";
    setManagedBannerDismissed(managedDismissed);

    let cancelled = false;

    void checkForUpdate()
      .then((result) => {
        if (cancelled || result.disabled) return;

        if (result.managed) {
          setManagedSource(true);
          setManagedMessage(typeof result.managedMessage === "string" ? result.managedMessage : null);
          setManagedStatus(result.managedStatus ?? null);
          setUpdateAvailable(false);
          setLatestVersion(null);
          setCurrentVersion(typeof result.currentVersion === "string" ? result.currentVersion : null);
          return;
        }

        setManagedSource(false);
        setManagedMessage(null);
        setManagedStatus(null);
        setUpdateAvailable(result.updateAvailable === true);
        setLatestVersion(typeof result.latestVersion === "string" ? result.latestVersion : null);
        setCurrentVersion(typeof result.currentVersion === "string" ? result.currentVersion : null);
      })
      .catch(() => {
        // Fail silently. Update checks are best-effort.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.setItem(UPDATE_BANNER_DISMISSED_KEY, "true");
  }, []);

  const dismissManagedBanner = useCallback(() => {
    setManagedBannerDismissed(true);
    sessionStorage.setItem(MANAGED_SOURCE_BANNER_DISMISSED_KEY, "true");
  }, []);

  return {
    updateAvailable,
    latestVersion,
    currentVersion,
    loading,
    dismissed,
    dismiss,
    managedSource,
    managedMessage,
    managedStatus,
    managedBannerDismissed,
    dismissManagedBanner,
  };
}
