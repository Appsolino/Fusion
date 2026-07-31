import { definePlugin } from "@fusion/plugin-sdk";
import type { FusionPlugin } from "@fusion/plugin-sdk";
import { probeCursorBinary } from "./probe.js";
import { discoverCursorProviderModels } from "./provider.js";
import { CursorRuntimeAdapter } from "./runtime-adapter.js";

const plugin: FusionPlugin = definePlugin({
  manifest: {
    id: "fusion-plugin-cursor-runtime",
    name: "Cursor Runtime Plugin",
    version: "0.1.0",
    description: "Cursor CLI runtime support for Fusion",
    runtime: {
      runtimeId: "cursor",
      name: "Cursor Runtime",
      version: "0.1.0",
    },
  },
  state: "installed",
  hooks: {},
  runtime: {
    metadata: {
      runtimeId: "cursor",
      name: "Cursor Runtime",
      version: "0.1.0",
    },
    /*
    FNXC:CursorCli 2026-07-31-09:40:
    ISS-CLI-005: pass plugin/context settings so an operator binaryPath override
    can reach the print-mode adapter (same path used by auth/probe discovery).
    */
    factory: async (ctx?: { settings?: Record<string, unknown> }) => {
      const binaryPath = typeof ctx?.settings?.binaryPath === "string"
        ? ctx.settings.binaryPath
        : typeof ctx?.settings?.cursorCliBinaryPath === "string"
          ? ctx.settings.cursorCliBinaryPath
          : undefined;
      return new CursorRuntimeAdapter({ binaryPath });
    },
  },
  cliProviders: [
    {
      providerId: "cursor-cli",
      displayName: "Cursor CLI",
      binaryName: "cursor-agent",
      providerType: "cli",
      statusRoute: "/providers/cursor-cli/status",
      authRoute: "/auth/cursor-cli",
      actions: [
        { actionId: "enable", label: "Enable", actionType: "enable", method: "POST", route: "/auth/cursor-cli" },
        { actionId: "disable", label: "Disable", actionType: "disable", method: "POST", route: "/auth/cursor-cli" },
        { actionId: "test", label: "Test", actionType: "test", method: "GET", route: "/providers/cursor-cli/status" }
      ],
      probe: async () => {
        const status = await probeCursorBinary();
        return {
          available: status.available,
          authenticated: status.authenticated,
          binaryPath: status.binaryPath,
          binaryName: status.binaryName,
          version: status.version,
          reason: status.reason,
        };
      },
      discoverModels: discoverCursorProviderModels,
      runtime: {
        runtimeId: "cursor",
        createAdapter: async (ctx?: { settings?: Record<string, unknown> }) => {
          const binaryPath = typeof ctx?.settings?.binaryPath === "string"
            ? ctx.settings.binaryPath
            : typeof ctx?.settings?.cursorCliBinaryPath === "string"
              ? ctx.settings.cursorCliBinaryPath
              : undefined;
          return new CursorRuntimeAdapter({ binaryPath });
        },
      },
    },
  ],
});

export default plugin;
export { probeCursorBinary } from "./probe.js";
export { discoverCursorProviderModels } from "./provider.js";
export type { CursorBinaryStatus } from "./types.js";
