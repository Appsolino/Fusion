import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets } from "./redact-secrets.js";

/*
FNXC:AppsolinoManagedSource 2026-07-24-17:00:
When FUSION_MANAGED_SOURCE=appsolino, Fusion must not offer npm/global source replacement (CLI fn update, dashboard Update now, or settings-driven npm install). Operators instead read sanitized update state from the Appsolino integration status file and optional release provenance beside the running build.
*/

export const APPSOLINO_MANAGED_SOURCE_ENV = "appsolino";
export const DEFAULT_MANAGED_SOURCE_STATUS_PATH =
  "/srv/software-factory/integrations/fusion-update/state/status.json";

export const MANAGED_SOURCE_UPDATE_MESSAGE = "Updates are managed automatically by Appsolino.";

const MANAGED_SOURCE_STATUS_ENV = "FUSION_MANAGED_SOURCE_STATUS";

const STATUS_FIELD_KEYS = [
  "deployedSha",
  "upstreamSha",
  "candidatePr",
  "ciStatus",
  "lastSuccessfulUpdate",
  "lastFailure",
  "state",
  "upstreamVersion",
  "releaseSha",
  "buildTimestamp",
  "updateStatus",
] as const;

const PROVENANCE_FIELD_KEYS = ["upstreamVersion", "stableSha", "appsolinoReleaseTag", "buildTimestamp"] as const;

export type ManagedSourceStatusField = (typeof STATUS_FIELD_KEYS)[number];
export type AppsolinoProvenanceField = (typeof PROVENANCE_FIELD_KEYS)[number];

export type ManagedSourceStatus = Partial<Record<ManagedSourceStatusField, string>>;

export type AppsolinoReleaseProvenance = Partial<Record<AppsolinoProvenanceField, string>>;

export type ManagedSourcePublicMetadata = {
  managedSource: boolean;
  managedMessage: string;
  statusPath: string;
  status: ManagedSourceStatus | null;
  provenance: AppsolinoReleaseProvenance | null;
};

const PROVENANCE_FILENAMES = ["APPSOLINO_RELEASE.json", "appsolino-release.json"] as const;

const MAX_SANITIZED_FIELD_CHARS = 512;

function sanitizeManagedFieldValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return redactSecrets(String(value)).slice(0, MAX_SANITIZED_FIELD_CHARS);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = redactSecrets(value.trim()).slice(0, MAX_SANITIZED_FIELD_CHARS);
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeStatusRecord(raw: unknown): ManagedSourceStatus | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const status: ManagedSourceStatus = {};
  for (const key of STATUS_FIELD_KEYS) {
    const value = sanitizeManagedFieldValue(record[key]);
    if (value !== undefined) {
      status[key] = value;
    }
  }
  return Object.keys(status).length > 0 ? status : null;
}

function sanitizeProvenanceRecord(raw: unknown): AppsolinoReleaseProvenance | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const provenance: AppsolinoReleaseProvenance = {};
  for (const key of PROVENANCE_FIELD_KEYS) {
    const value = sanitizeManagedFieldValue(record[key]);
    if (value !== undefined) {
      provenance[key] = value;
    }
  }
  return Object.keys(provenance).length > 0 ? provenance : null;
}

/** True when the host process is an Appsolino-managed Fusion build. */
export function isManagedSourceMode(): boolean {
  return process.env.FUSION_MANAGED_SOURCE === APPSOLINO_MANAGED_SOURCE_ENV;
}

/** Path to the Appsolino integration status.json (override via FUSION_MANAGED_SOURCE_STATUS). */
export function getManagedSourceStatusPath(): string {
  const override = process.env[MANAGED_SOURCE_STATUS_ENV];
  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }
  return DEFAULT_MANAGED_SOURCE_STATUS_PATH;
}

export type ReadManagedSourceStatusOptions = {
  statusPath?: string;
  readFile?: (path: string) => string;
};

/** Read and sanitize Appsolino status.json; returns null when missing or invalid (never throws). */
export function readManagedSourceStatus(options: ReadManagedSourceStatusOptions = {}): ManagedSourceStatus | null {
  const statusPath = options.statusPath ?? getManagedSourceStatusPath();
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf-8"));

  try {
    if (!options.readFile && !existsSync(statusPath)) {
      return null;
    }
    const parsed = JSON.parse(readFile(statusPath)) as unknown;
    return sanitizeStatusRecord(parsed);
  } catch {
    return null;
  }
}

export type ReadAppsolinoReleaseProvenanceOptions = {
  releaseRoot: string;
  readFile?: (path: string) => string;
};

/** Read optional APPSOLINO_RELEASE.json / appsolino-release.json beside the running build. */
export function readAppsolinoReleaseProvenance(
  options: ReadAppsolinoReleaseProvenanceOptions,
): AppsolinoReleaseProvenance | null {
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf-8"));
  for (const filename of PROVENANCE_FILENAMES) {
    const filePath = join(options.releaseRoot, filename);
    try {
      if (!options.readFile && !existsSync(filePath)) {
        continue;
      }
      const parsed = JSON.parse(readFile(filePath)) as unknown;
      const provenance = sanitizeProvenanceRecord(parsed);
      if (provenance) {
        return provenance;
      }
    } catch {
      // Try the next filename; never surface parse errors to callers.
    }
  }
  return null;
}

export function getManagedSourceRefusalMessage(): string {
  return (
    `Fusion updates are managed automatically by Appsolino. ` +
    `Manual source replacement via fn update is disabled. ` +
    `Managed update status is stored at ${getManagedSourceStatusPath()}.`
  );
}

/** Sanitized managed-source metadata for dashboard/API surfaces. */
export function getManagedSourcePublicMetadata(releaseRoot?: string): ManagedSourcePublicMetadata {
  if (!isManagedSourceMode()) {
    return {
      managedSource: false,
      managedMessage: "",
      statusPath: getManagedSourceStatusPath(),
      status: null,
      provenance: null,
    };
  }

  const status = readManagedSourceStatus();
  const provenance =
    typeof releaseRoot === "string" && releaseRoot.length > 0
      ? readAppsolinoReleaseProvenance({ releaseRoot })
      : null;

  return {
    managedSource: true,
    managedMessage: MANAGED_SOURCE_UPDATE_MESSAGE,
    statusPath: getManagedSourceStatusPath(),
    status,
    provenance,
  };
}

/** Short Appsolino release label for footer/version surfaces (SHA/tag, not npm semver). */
export function resolveAppsolinoReleaseDisplayLabel(
  metadata: Pick<ManagedSourcePublicMetadata, "status" | "provenance">,
): string | null {
  const candidates = [
    metadata.provenance?.stableSha,
    metadata.status?.releaseSha,
    metadata.status?.deployedSha,
    metadata.provenance?.appsolinoReleaseTag,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}
