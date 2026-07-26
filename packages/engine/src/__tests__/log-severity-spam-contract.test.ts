/**
 * FNXC:EngineDiagnostics 2026-07-26-08:17:
 * Contract tests that high-frequency steady-state chatter stays on `debug()` / FUSION_DEBUG,
 * so a reversion to info-level spam fails CI. Complements logger-debug-gating (framework) with
 * shipped call-site severity for known TUI flood classes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../logger.js";

const engineSrc = join(__dirname, "..");

function readSrc(relative: string): string {
  return readFileSync(join(engineSrc, relative), "utf8");
}

describe("log severity spam contract (source)", () => {
  it("maintenance batch per-step success uses debug, not log", () => {
    const src = readSrc("self-healing.ts");
    expect(src).toMatch(/log\.debug\(`Maintenance batch 1 step "\$\{fn\.name\}" succeeded`\)/);
    expect(src).toMatch(/log\.debug\(`Maintenance batch 2 step "\$\{fn\.name\}" succeeded`\)/);
    expect(src).not.toMatch(/log\.log\(`Maintenance batch [123] step "\$\{fn\.name\}" succeeded`\)/);
  });

  it("requested-skill listing diagnostics route to debug", () => {
    const pi = readSrc("pi.ts");
    const resolver = readSrc("skill-resolver.ts");
    expect(pi).toMatch(/diag\.message\.startsWith\("Requested skill:"\)[\s\S]*piLog\.debug/);
    expect(resolver).toMatch(/isRequestedSkillListingDiagnostic/);
    expect(resolver).toMatch(/piLog\.debug\(msg\)/);
  });

  it("activity-recorded heartbeats and periodic stuck poll use debug", () => {
    const src = readSrc("stuck-task-detector.ts");
    expect(src).toMatch(/stuckLog\.debug\(\s*`Activity recorded for/);
    expect(src).toMatch(/stuckLog\.debug\("Running periodic stuck task check \(polling\)"\)/);
    expect(src).not.toMatch(/stuckLog\.log\(\s*`Activity recorded for/);
    expect(src).not.toMatch(/stuckLog\.log\("Running periodic stuck task check \(polling\)"\)/);
  });

  it("heartbeat timer skip gates use debug", () => {
    const src = readSrc("agent-heartbeat.ts");
    expect(src).toMatch(/heartbeatLog\.debug\(`Timer tick skipped for \$\{agentId\} \(active run\)`\)/);
    expect(src).toMatch(/heartbeatLog\.debug\(`Timer tick skipped for \$\{agentId\} \(global pause active\)`\)/);
    expect(src).not.toMatch(/heartbeatLog\.log\(`Timer tick skipped for \$\{agentId\} \(active run\)`\)/);
  });

  it("cron multi-scope skip chatter uses debug; execute stays on log", () => {
    const src = readSrc("cron-runner.ts");
    expect(src).toMatch(/log\.debug\(`Skipping \$\{schedule\.name\}[\s\S]*already executed from another scope/);
    expect(src).toMatch(/log\.debug\(`Skipping \$\{schedule\.name\}[\s\S]*claim lost to another poller/);
    expect(src).toMatch(/log\.log\(`Executing \$\{schedule\.name\}/);
  });

  it("plugin skill contribution/merge chatter uses debug", () => {
    const src = readSrc("session-skill-context.ts");
    expect(src).toMatch(/piLog\.debug\(`\[skills\] Plugin \$\{pluginId\} contributes skill:/);
    expect(src).toMatch(/piLog\.debug\(\s*`\[skills\] Merged \$\{appendedPluginNames\.length\}/);
  });

  it("hold-release capacity race uses debug like deferred-no-slot", () => {
    const src = readSrc("hold-release.ts");
    expect(src).toMatch(/schedulerLog\.debug\(`Hold release for \$\{task\.id\} rejected on capacity/);
    expect(src).toMatch(/schedulerLog\.debug\(`Hold release for \$\{task\.id\} deferred — no reservable slot/);
  });

  it("routine-scheduler re-entrance and pause no-ops use debug", () => {
    const src = readSrc("routine-scheduler.ts");
    expect(src).toMatch(/logger\.debug\("Tick already in progress, skipping"\)/);
    expect(src).toMatch(/logger\.debug\(\s*`Paused: globalPause=/);
    expect(src).not.toMatch(/logger\.log\("Tick already in progress, skipping"\)/);
    expect(src).not.toMatch(/logger\.log\(\s*`Paused: globalPause=/);
  });

  it("peer-exchange zero-work sync cycle uses debug; non-zero/error stay on log", () => {
    const src = readSrc("peer-exchange-service.ts");
    expect(src).toMatch(/peerExchangeLog\.debug\(`Starting sync with \$\{onlineRemoteNodes\.length\} peers`\)/);
    expect(src).toMatch(/peerExchangeLog\.debug\(\s*`Sync complete: \$\{onlineRemoteNodes\.length\} peers synced\./);
    // Non-zero discovery path and error summary remain log
    expect(src).toMatch(/else if \(totalAdded > 0 \|\| totalUpdated > 0\) \{\s*peerExchangeLog\.log\(/);
    expect(src).toMatch(/if \(errors\.length > 0\) \{\s*peerExchangeLog\.log\(/);
    expect(src).not.toMatch(/peerExchangeLog\.log\(`Starting sync with \$\{onlineRemoteNodes\.length\} peers`\)/);
  });
});

describe("log severity spam contract (runtime gating)", () => {
  const original = process.env.FUSION_DEBUG;

  beforeEach(() => {
    delete process.env.FUSION_DEBUG;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.FUSION_DEBUG;
    else process.env.FUSION_DEBUG = original;
  });

  it("createLogger debug is silent without FUSION_DEBUG and emits when opted in", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = createLogger("stuck-detector");

    log.debug("Activity recorded for FN-1 (sinceProgress=1)");
    expect(errorSpy).not.toHaveBeenCalled();

    process.env.FUSION_DEBUG = "stuck-detector";
    log.debug("Activity recorded for FN-1 (sinceProgress=1)");
    expect(errorSpy).toHaveBeenCalled();
    const payload = String(errorSpy.mock.calls[0]![0]);
    expect(payload).toContain("[stuck-detector]");
    expect(payload).toContain("Activity recorded");

    errorSpy.mockRestore();
  });

  it("log/warn/error remain ungated by FUSION_DEBUG", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = createLogger("heartbeat");

    log.log("Executing heartbeat for agent-1 (source=timer)");
    log.warn("something needs attention");
    log.error("hard failure");

    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("routine-scheduler and peer-exchange debug channels stay silent without FUSION_DEBUG", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const routineLog = createLogger("routine-scheduler");
    const peerLog = createLogger("peer-exchange");

    routineLog.debug("Tick already in progress, skipping");
    routineLog.debug("Paused: globalPause=true, enginePaused=false");
    peerLog.debug("Starting sync with 2 peers");
    peerLog.debug("Sync complete: 2 peers synced. 0 new peers discovered, 0 updated.");
    expect(errorSpy).not.toHaveBeenCalled();

    process.env.FUSION_DEBUG = "routine-scheduler,peer-exchange";
    routineLog.debug("Tick already in progress, skipping");
    peerLog.debug("Starting sync with 2 peers");
    expect(errorSpy).toHaveBeenCalled();
    const joined = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(joined).toContain("[routine-scheduler]");
    expect(joined).toContain("[peer-exchange]");

    errorSpy.mockRestore();
  });
});
