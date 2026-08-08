/**
 * FNXC:PluginLoader 2026-07-07-00:00:
 * Bundled-plugin auto-install logic was ported to @fusion/core
 * (packages/core/src/plugins/bundled-plugin-install.ts) so the desktop embedded
 * runtime can auto-install bundled runtime plugins without depending on this CLI
 * package (FN-7637). This module is now a thin, behavior-preserving CLI adapter:
 * it supplies the CLI-specific candidate bundle-directory resolution
 * (`<cli>/dist/plugins/<id>` staged layout, resolved from `import.meta.url`) to
 * the shared helper and re-exports the same public surface `dashboard.ts`,
 * `serve.ts`, and `daemon.ts` already depend on. `resolvePluginEntryPath` is
 * re-exported directly from `@fusion/core` (no local duplicate) since the
 * shared helper already delegates to it.
 *
 * FNXC:SoakR3PluginFreshness 2026-08-08-09:42:
 * Host D AUTO-3 SEA layout stages plugins beside the compiled `fn` binary
 * (`<execDir>/plugins/<id>`). import.meta-relative probes alone returned
 * missing-bundle and left the stale FUSION_HOME registration active
 * (SOAK-R3-DEFECT-001). Probe execPath-adjacent plugins first for packaged SEA
 * installs; Node/npm installs keep succeeding via the subsequent dist-relative
 * candidates when execDir/plugins does not exist.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureBundledCursorRuntimePluginInstalled as coreEnsureBundledCursorRuntimePluginInstalled,
  ensureBundledGrokRuntimePluginInstalled as coreEnsureBundledGrokRuntimePluginInstalled,
  ensureBundledDependencyGraphPluginInstalled as coreEnsureBundledDependencyGraphPluginInstalled,
  ensureBundledPluginInstalled as coreEnsureBundledPluginInstalled,
  assessBundledPluginFreshness as coreAssessBundledPluginFreshness,
  type EnsureBundledResult,
  type PluginLoader,
  type PluginStore,
  type BundledPluginFreshnessReport,
} from "@fusion/core";

export { BUNDLED_PLUGIN_IDS, isBundledPluginId, resolvePluginEntryPath } from "@fusion/core";
export type { BundledPluginId, EnsureBundledResult, BundledPluginFreshnessReport } from "@fusion/core";

/*
FNXC:PluginLoader 2026-07-10-00:00:
Candidate order encodes a freshness contract, not just a search path.

Published/global install (the regression the first candidate protects): plugins
are staged next to the running bin at `<cli>/dist/plugins/<id>`, and no workspace
`plugins/` dir exists — so `join(moduleDir, "plugins", <id>)` MUST stay first and
win.

Source checkout / `pnpm dev` (the durability fix): the running dashboard would
otherwise resolve the STAGED tsup bundle at `<cli>/dist/plugins/<id>/bundled.js`,
which `resolvePluginEntryPath` prefers verbatim with NO freshness check. That
bundle is a build artifact only `tsup` regenerates — the FN-7779 dev prebuild
rebuilds each plugin's OWN `plugins/<id>/dist` but never the staged bundle, so a
source-only plugin fix (e.g. the FN-7796 Grok adapter) silently ran stale and
grok chat returned empty replies. Probe the workspace source dir
(`<repo>/plugins/<id>`) BEFORE the staged bundle so dev loads the live plugin
whose entry `resolvePluginEntryPath` freshness-checks (dist vs src) — self-healing
even when the prebuild is skipped. The workspace dir only exists in a checkout, so
published installs are unaffected.
*/
export function getCandidatePluginDirs(pluginId: string): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const cliPackageRoot = resolve(moduleDir, "..", "..");
  const execDir = dirname(process.execPath);
  const packageRootOverride = process.env.FUSION_PACKAGE_ROOT?.trim();

  const candidates = [
    // SEA / Host D packaged layout: plugins next to compiled `fn` (SOAK-R3-DEFECT-001).
    join(execDir, "plugins", pluginId),
    // Optional deploy override (tests / alternate package roots).
    ...(packageRootOverride ? [join(packageRootOverride, "plugins", pluginId)] : []),
    // Bundled/global runtime: moduleDir is typically <cli>/dist, and plugins are
    // staged under <cli>/dist/plugins/<id>. Keep for the global-install regression.
    join(moduleDir, "plugins", pluginId),
    // Source checkout: prefer the live workspace plugin (freshness-checked by
    // resolvePluginEntryPath) over the stale staged tsup bundle below.
    join(cliPackageRoot, "..", "..", "plugins", pluginId),
    // Source/dev fallbacks.
    join(cliPackageRoot, "dist", "plugins", pluginId),
    join(cliPackageRoot, "plugins", pluginId),
  ];
  return [...new Set(candidates)];
}

export async function ensureBundledPluginInstalled(
  pluginStore: PluginStore,
  pluginLoader: PluginLoader,
  pluginId: string,
): Promise<EnsureBundledResult> {
  return coreEnsureBundledPluginInstalled(pluginStore, pluginLoader, pluginId, getCandidatePluginDirs);
}

/**
 * @deprecated Use {@link ensureBundledPluginInstalled} with the explicit plugin id.
 * Kept for backwards compatibility with existing call sites.
 */
export async function ensureBundledDependencyGraphPluginInstalled(
  pluginStore: PluginStore,
  pluginLoader: PluginLoader,
): Promise<EnsureBundledResult> {
  return coreEnsureBundledDependencyGraphPluginInstalled(pluginStore, pluginLoader, getCandidatePluginDirs);
}

export async function ensureBundledCursorRuntimePluginInstalled(
  pluginStore: PluginStore,
  pluginLoader: PluginLoader,
): Promise<EnsureBundledResult> {
  return coreEnsureBundledCursorRuntimePluginInstalled(pluginStore, pluginLoader, getCandidatePluginDirs);
}

export async function ensureBundledGrokRuntimePluginInstalled(
  pluginStore: PluginStore,
  pluginLoader: PluginLoader,
): Promise<EnsureBundledResult> {
  return coreEnsureBundledGrokRuntimePluginInstalled(pluginStore, pluginLoader, getCandidatePluginDirs);
}

export async function assessBundledPluginFreshness(
  pluginStore: PluginStore,
  pluginId: string,
): Promise<BundledPluginFreshnessReport> {
  return coreAssessBundledPluginFreshness(pluginStore, pluginId, getCandidatePluginDirs);
}
