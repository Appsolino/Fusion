import { createLogger } from "../process/logger.js";

const severityAuditLog = createLogger("core-bundled-plugin-install");
/**
 * FNXC:PluginLoader 2026-07-07-00:00:
 * Bundled-plugin auto-install is host-agnostic in @fusion/core. Hosts (the CLI's
 * `<cli>/dist/plugins/<id>` staging layout vs the desktop `@fusion-plugin-examples/<short>`
 * node_modules layout) supply their own bundle-directory resolution — the ONLY
 * host-specific concern — via the `getCandidatePluginDirs` parameter below. This
 * lets the identical install/update/fail-soft-load logic run under both the CLI
 * `dashboard`/`serve`/`daemon` commands and the desktop embedded runtime
 * (`local-runtime.ts` / `local-server.ts`) without `packages/desktop` depending on
 * the CLI package (FN-7637; builds on FN-7623's desktop pluginStore/pluginLoader
 * wiring). Everything below except `getCandidatePluginDirs`/`resolveBundledPluginDir`
 * is a direct, behavior-preserving port of `packages/cli/src/plugins/bundled-plugin-install.ts`.
 *
 * FNXC:SoakR3PluginFreshness 2026-08-08-09:42:
 * SOAK-R3-DEFECT-001: Host D SEA packages stage plugins next to `fn`, but ensure
 * previously only probed import.meta-relative paths and skipped when the bundle
 * was "not found". The stale FUSION_HOME registration (same id + manifest 0.1.0)
 * kept serving old code without settleFallbackDispatch. Contract A: bundled plugin
 * content freshness is independent of manifest semver — compare SHA-256 of the
 * loadable entry and always point the active install at the release-staged entry.
 */

import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validatePluginManifest } from "./plugin-types.js";
import type { PluginInstallation, PluginManifest } from "./plugin-types.js";
import { resolvePluginEntryPath } from "./plugin-loader.js";
import type { PluginLoader } from "./plugin-loader.js";
import type { PluginStore } from "../stores/plugin-store.js";

const DEPENDENCY_GRAPH_PLUGIN_ID = "fusion-plugin-dependency-graph";
const CURSOR_RUNTIME_PLUGIN_ID = "fusion-plugin-cursor-runtime";
const GROK_RUNTIME_PLUGIN_ID = "fusion-plugin-grok-runtime";
export const CLAUDE_RUNTIME_PLUGIN_ID = "fusion-plugin-claude-runtime";

export const BUNDLED_PLUGIN_IDS = [
  "fusion-plugin-dependency-graph",
  "fusion-plugin-reports",
  "fusion-plugin-whatsapp-chat",
  "fusion-plugin-roadmap",
  "fusion-plugin-todos",
  "fusion-plugin-hermes-runtime",
  "fusion-plugin-openclaw-runtime",
  "fusion-plugin-paperclip-runtime",
  "fusion-plugin-cursor-runtime",
  "fusion-plugin-grok-runtime",
  "fusion-plugin-claude-runtime",
  // FNXC:OmpAcp 2026-07-11-23:35: Oh My Pi ACP runtime available as a staged/bundled install target.
  "fusion-plugin-omp-runtime",
  "fusion-plugin-cli-printing-press",
  "fusion-plugin-compound-engineering",
  "fusion-plugin-linear-import",
  "fusion-plugin-quality",
] as const;

export type BundledPluginId = (typeof BUNDLED_PLUGIN_IDS)[number];

export function isBundledPluginId(id: string): id is BundledPluginId {
  return (BUNDLED_PLUGIN_IDS as readonly string[]).includes(id);
}

export type EnsureBundledResult =
  | "installed"
  | "updated"
  | "already-installed"
  | "missing-bundle";

/** Host-supplied resolver: given a plugin id, return candidate directories to probe for `manifest.json`. */
export type BundledPluginDirResolver = (pluginId: string) => string[];

export type BundledPluginFreshnessStatus =
  | "pass"
  | "missing-bundle"
  | "missing-active"
  | "mismatch"
  | "unreadable";

export type BundledPluginFreshnessReport = {
  pluginId: string;
  status: BundledPluginFreshnessStatus;
  bundledDir: string | null;
  bundledEntryPath: string | null;
  activePath: string | null;
  bundledFingerprint: string | null;
  activeFingerprint: string | null;
  match: boolean;
  settleFallbackDispatchMarkerPresent?: boolean | null;
  reason?: string;
};

async function loadManifest(pluginDir: string): Promise<PluginManifest> {
  const manifestPath = join(pluginDir, "manifest.json");
  const content = await readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(content);
  const validation = validatePluginManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Invalid plugin manifest: ${validation.errors.join(", ")}`);
  }
  return manifest;
}

function resolveBundledPluginDir(pluginId: string, getCandidatePluginDirs: BundledPluginDirResolver): string | null {
  for (const path of getCandidatePluginDirs(pluginId)) {
    if (existsSync(join(path, "manifest.json"))) {
      return path;
    }
  }
  return null;
}

function isDirectoryPath(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Content identity for a loadable plugin entry. Manifest semver alone cannot prove
 * bundled runtime freshness when implementation changes land under the same version.
 */
export async function fingerprintPluginEntry(entryPath: string): Promise<string | null> {
  try {
    const bytes = await readFile(entryPath);
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

function entryExposesSettleFallbackDispatch(source: string): boolean {
  return source.includes("settleFallbackDispatch");
}

/**
 * Read-only freshness verdict for a bundled plugin id against the running release's
 * staged bundle and the currently registered active install path.
 */
export async function assessBundledPluginFreshness(
  pluginStore: PluginStore,
  pluginId: string,
  getCandidatePluginDirs: BundledPluginDirResolver,
): Promise<BundledPluginFreshnessReport> {
  const bundledDir = resolveBundledPluginDir(pluginId, getCandidatePluginDirs);
  if (!bundledDir) {
    return {
      pluginId,
      status: "missing-bundle",
      bundledDir: null,
      bundledEntryPath: null,
      activePath: null,
      bundledFingerprint: null,
      activeFingerprint: null,
      match: false,
      reason: "bundled plugin directory not found for running release",
    };
  }

  const bundledEntryPath = resolvePluginEntryPath(bundledDir);
  if (!bundledEntryPath) {
    return {
      pluginId,
      status: "missing-bundle",
      bundledDir,
      bundledEntryPath: null,
      activePath: null,
      bundledFingerprint: null,
      activeFingerprint: null,
      match: false,
      reason: "bundled plugin has no loadable entry",
    };
  }

  const bundledFingerprint = await fingerprintPluginEntry(bundledEntryPath);
  let settleMarker: boolean | null = null;
  try {
    settleMarker = entryExposesSettleFallbackDispatch(await readFile(bundledEntryPath, "utf-8"));
  } catch {
    settleMarker = null;
  }

  let existing: PluginInstallation | null = null;
  try {
    existing = await pluginStore.getPlugin(pluginId);
  } catch {
    existing = null;
  }

  if (!existing) {
    return {
      pluginId,
      status: "missing-active",
      bundledDir,
      bundledEntryPath,
      activePath: null,
      bundledFingerprint,
      activeFingerprint: null,
      match: false,
      settleFallbackDispatchMarkerPresent: settleMarker,
      reason: "plugin not registered in plugin store",
    };
  }

  const activePath = existing.path;
  const activeFingerprint = await fingerprintPluginEntry(activePath);
  if (!bundledFingerprint || !activeFingerprint) {
    return {
      pluginId,
      status: "unreadable",
      bundledDir,
      bundledEntryPath,
      activePath,
      bundledFingerprint,
      activeFingerprint,
      match: false,
      settleFallbackDispatchMarkerPresent: settleMarker,
      reason: "unable to fingerprint bundled or active entry",
    };
  }

  const match = bundledFingerprint === activeFingerprint && activePath === bundledEntryPath;
  return {
    pluginId,
    status: match ? "pass" : "mismatch",
    bundledDir,
    bundledEntryPath,
    activePath,
    bundledFingerprint,
    activeFingerprint,
    match,
    settleFallbackDispatchMarkerPresent: settleMarker,
    reason: match
      ? undefined
      : activePath !== bundledEntryPath
        ? "active path differs from release-staged bundled entry"
        : "active entry fingerprint differs from bundled entry",
  };
}

async function activateBundledPlugin(
  pluginLoader: PluginLoader,
  pluginId: string,
  forceReload: boolean,
): Promise<void> {
  try {
    if (forceReload && typeof pluginLoader.reloadPlugin === "function" && pluginLoader.isPluginLoaded?.(pluginId)) {
      await pluginLoader.reloadPlugin(pluginId);
      return;
    }
    await pluginLoader.loadPlugin(pluginId);
  } catch (err) {
    severityAuditLog.warn("[plugins] failed to load bundled plugin", pluginId, err);
  }
}

/**
 * Ensure a bundled runtime plugin is registered (and, if enabled, loaded) in the
 * given `pluginStore`/`pluginLoader`. The only host-specific input is
 * `getCandidatePluginDirs`, which returns the ordered list of directories to probe
 * for a `manifest.json` for the given plugin id — the CLI supplies its
 * `<cli>/dist/plugins/<id>` search paths (plus SEA `execPath/plugins/<id>`), desktop supplies its
 * `node_modules/@fusion-plugin-examples/<short>` resolution. See `resolvePluginEntryPath`
 * (also in `@fusion/core`) for the loadable-entry-file selection this helper reuses
 * rather than re-duplicating.
 */
export async function ensureBundledPluginInstalled(
  pluginStore: PluginStore,
  pluginLoader: PluginLoader,
  pluginId: string,
  getCandidatePluginDirs: BundledPluginDirResolver,
): Promise<EnsureBundledResult> {
  let existingPlugin: PluginInstallation | null = null;
  try {
    existingPlugin = await pluginStore.getPlugin(pluginId);
  } catch {
    // Continue; plugin not installed yet.
  }

  const bundledDir = resolveBundledPluginDir(pluginId, getCandidatePluginDirs);
  if (!bundledDir) {
    return "missing-bundle";
  }

  const manifest = await loadManifest(bundledDir);
  const entryPath = resolvePluginEntryPath(bundledDir);

  if (!entryPath) {
    severityAuditLog.warn(`[plugins] Bundled plugin "${pluginId}" is missing a loadable entry file in ${bundledDir}`);
    return "missing-bundle";
  }

  const bundledFingerprint = await fingerprintPluginEntry(entryPath);

  if (existingPlugin) {
    const existingPathIsDirectory = isDirectoryPath(existingPlugin.path);
    const pathChanged = existingPathIsDirectory || existingPlugin.path !== entryPath;
    const versionChanged = existingPlugin.version !== manifest.version;
    const activeFingerprint = await fingerprintPluginEntry(existingPlugin.path);
    const contentChanged =
      bundledFingerprint !== null
      && activeFingerprint !== null
      && bundledFingerprint !== activeFingerprint;

    if (!pathChanged && !versionChanged && !contentChanged) {
      if (existingPlugin.enabled) {
        await activateBundledPlugin(pluginLoader, existingPlugin.id, false);
      }
      return "already-installed";
    }

    /*
    FNXC:SoakR3PluginFreshness 2026-08-08-09:42:
    Always retarget the registered path to the release-staged entry when content
    or path drifts — never leave a persistent FUSION_HOME copy authoritative for
    a bundled plugin id after a Fusion deploy that shipped newer code.
    */
    await pluginStore.updatePlugin(pluginId, {
      path: entryPath,
      ...(versionChanged ? { version: manifest.version } : {}),
    });

    if (existingPlugin.enabled) {
      await activateBundledPlugin(pluginLoader, existingPlugin.id, true);
    }

    severityAuditLog.log(
      `[plugins] Reconciled bundled plugin "${pluginId}" `
      + `(pathChanged=${pathChanged} versionChanged=${versionChanged} contentChanged=${contentChanged})`,
    );
    return "updated";
  }

  const plugin = await pluginStore.registerPlugin({
    manifest,
    path: entryPath,
  });

  if (plugin.enabled) {
    await activateBundledPlugin(pluginLoader, plugin.id, false);
  }

  return "installed";
}

/**
 * @deprecated Use {@link ensureBundledPluginInstalled} with the explicit plugin id.
 * Kept for backwards compatibility with existing call sites.
 */
export async function ensureBundledDependencyGraphPluginInstalled(
  pluginStore: PluginStore,
  pluginLoader: PluginLoader,
  getCandidatePluginDirs: BundledPluginDirResolver,
): Promise<EnsureBundledResult> {
  return ensureBundledPluginInstalled(pluginStore, pluginLoader, DEPENDENCY_GRAPH_PLUGIN_ID, getCandidatePluginDirs);
}

export async function ensureBundledCursorRuntimePluginInstalled(
  pluginStore: PluginStore,
  pluginLoader: PluginLoader,
  getCandidatePluginDirs: BundledPluginDirResolver,
): Promise<EnsureBundledResult> {
  return ensureBundledPluginInstalled(pluginStore, pluginLoader, CURSOR_RUNTIME_PLUGIN_ID, getCandidatePluginDirs);
}

export async function ensureBundledGrokRuntimePluginInstalled(
  pluginStore: PluginStore,
  pluginLoader: PluginLoader,
  getCandidatePluginDirs: BundledPluginDirResolver,
): Promise<EnsureBundledResult> {
  return ensureBundledPluginInstalled(pluginStore, pluginLoader, GROK_RUNTIME_PLUGIN_ID, getCandidatePluginDirs);
}
