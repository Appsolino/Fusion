#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoAuto2 2026-07-31-18:00:
 * Trusted AUTO-2 risk classifier. Runs only on trusted code (Appsolino main / finalizer).
 * Never treat unknown paths as low risk. Large change sets and workflow/migration/auth/
 * provider/release/dependency touches are mandatory sensitive. Blocked for conflicts,
 * failed checks, stale SHA, or missing inputs.
 */
import { fileURLToPath } from "node:url";

/** @typedef {"low"|"medium"|"sensitive"|"blocked"} RiskClass */

export const LARGE_FILE_COUNT = 80;
export const LARGE_COMMIT_COUNT = 40;

export const LABEL_APPROVAL = "auto2:approval-required";
export const LABEL_BLOCKED = "auto2:blocked";
export const LABEL_LOW = "auto2:low-risk";
export const LABEL_MEDIUM = "auto2:medium";
export const REPORT_MARKER = "<!-- auto2-report -->";

/**
 * @param {string} file
 */
export function pathFlags(file) {
  const f = file.replace(/\\/g, "/");
  return {
    workflow: f.startsWith(".github/workflows/") || f.startsWith(".github/actions/"),
    migration:
      /(^|\/)migrations?\//i.test(f) ||
      /\.sql$/i.test(f) ||
      /schema/i.test(f) && /(db|database|postgres|sql)/i.test(f),
    dependencyManifest:
      /(^|\/)package\.json$/.test(f) ||
      /(^|\/)pnpm-workspace\.yaml$/.test(f) ||
      /(^|\/)Cargo\.toml$/.test(f),
    lockfile:
      /(^|\/)pnpm-lock\.yaml$/.test(f) ||
      /(^|\/)package-lock\.json$/.test(f) ||
      /(^|\/)yarn\.lock$/.test(f),
    authentication:
      /auth/i.test(f) ||
      /oauth/i.test(f) ||
      /secret/i.test(f) ||
      /credential/i.test(f) ||
      /permission/i.test(f),
    providerRuntime:
      /provider/i.test(f) ||
      /cursor-cli/i.test(f) ||
      /plugins?\//i.test(f) ||
      /pi-extension/i.test(f) ||
      /runtime/i.test(f),
    releaseInfra:
      /release/i.test(f) ||
      /installer/i.test(f) ||
      /systemd/i.test(f) ||
      /(^|\/)infra\//i.test(f) ||
      /deploy/i.test(f) ||
      /Dockerfile/i.test(f) ||
      /compose\.ya?ml$/i.test(f),
    database:
      /postgres/i.test(f) ||
      /database/i.test(f) ||
      /drizzle/i.test(f) ||
      /knex/i.test(f),
    governance:
      /docs\/appsolino\//i.test(f) && /MASTER-PLAN|OPERATING-MODEL|CURRENT-STATE|AGENTS\.md/i.test(f) ||
      f === "AGENTS.md" ||
      f.startsWith(".cursor/") ||
      f.includes("upstream-auto"),
    engine: f.startsWith("packages/engine/") || f.startsWith("packages/core/"),
    dashboard: f.startsWith("packages/dashboard/"),
    docsOnly:
      (f.startsWith("docs/") || /\.md$/i.test(f)) &&
      !/MASTER-PLAN|OPERATING-MODEL|CURRENT-STATE/i.test(f),
  };
}

/**
 * @param {string[]} files
 */
export function aggregateFlags(files) {
  /** @type {ReturnType<typeof pathFlags>} */
  const out = {
    workflow: false,
    migration: false,
    dependencyManifest: false,
    lockfile: false,
    authentication: false,
    providerRuntime: false,
    releaseInfra: false,
    database: false,
    governance: false,
    engine: false,
    dashboard: false,
    docsOnly: true,
  };
  for (const file of files) {
    const p = pathFlags(file);
    for (const k of Object.keys(out)) {
      if (k === "docsOnly") continue;
      // @ts-expect-error index
      if (p[k]) out[k] = true;
    }
    if (!p.docsOnly) out.docsOnly = false;
  }
  if (files.length === 0) out.docsOnly = false;
  return out;
}

/**
 * FNXC:AppsolinoAuto2 2026-07-31-18:00:
 * Deterministic affected-suite map. Sensitive may run all; low/medium select subsets.
 * @param {ReturnType<typeof aggregateFlags>} flags
 * @param {RiskClass} riskClass
 */
export function requiredSuitesFor(flags, riskClass) {
  /** @type {string[]} */
  const suites = ["integrity", "git-diff-check", "changesets", "typecheck-build-graph"];
  if (flags.engine || flags.providerRuntime || riskClass === "sensitive" || riskClass === "blocked") {
    suites.push("engine-affected", "correction-b-deterministic-failure", "cursor-provider-regression");
  }
  if (flags.releaseInfra || riskClass === "sensitive") {
    suites.push("correction-a-execute-bits", "packaged-runtime-smoke");
  }
  if (flags.migration || flags.database || riskClass === "sensitive") {
    suites.push(
      "migration-ordering",
      "migration-duplicate-number",
      "migration-ceiling",
      "migration-clean-db",
      "migration-upgrade-from-host-d",
    );
  }
  if (flags.workflow || riskClass === "sensitive") {
    suites.push("workflow-yaml-syntax", "workflow-permissions-review", "workflow-pinned-actions");
  }
  if (flags.dashboard && riskClass !== "sensitive") {
    suites.push("dashboard-unit");
  }
  if (riskClass === "sensitive") {
    suites.push("dashboard-unit");
  }
  return [...new Set(suites)];
}

/**
 * @param {object} input
 * @param {string[]} input.changedFiles
 * @param {number} [input.commitCount]
 * @param {boolean} [input.hasMergeConflict]
 * @param {boolean} [input.requiredChecksFailed]
 * @param {boolean} [input.staleValidatedSha]
 * @param {boolean} [input.missingClassificationData]
 * @param {boolean} [input.missingAppIdentity]
 * @param {boolean} [input.cannotDetermineMigrations]
 * @param {string} [input.validatedHeadSha]
 * @param {boolean} [input.isAutomationPr]
 */
export function classifyUpstream(input) {
  const files = Array.isArray(input.changedFiles) ? input.changedFiles : [];
  const commitCount = Number(input.commitCount ?? 0);
  /** @type {string[]} */
  const reasons = [];
  const flags = aggregateFlags(files);

  if (input.missingClassificationData) {
    return blocked("missing classification data", files, commitCount, flags, input.validatedHeadSha);
  }
  if (input.missingAppIdentity) {
    return blocked("missing App identity", files, commitCount, flags, input.validatedHeadSha);
  }
  if (input.hasMergeConflict) {
    return blocked("merge conflict", files, commitCount, flags, input.validatedHeadSha);
  }
  if (input.requiredChecksFailed) {
    return blocked("required checks failed", files, commitCount, flags, input.validatedHeadSha);
  }
  if (input.staleValidatedSha) {
    return blocked("stale validated SHA", files, commitCount, flags, input.validatedHeadSha);
  }
  if (input.cannotDetermineMigrations) {
    return blocked("unable to determine migrations or affected tests", files, commitCount, flags, input.validatedHeadSha);
  }
  if (input.isAutomationPr === false) {
    return {
      riskClass: /** @type {RiskClass} */ ("blocked"),
      reasons: ["non-automation PR ignored"],
      changedFileCount: files.length,
      commitCount,
      touchesWorkflows: flags.workflow,
      touchesMigrations: flags.migration,
      touchesDependencies: flags.dependencyManifest,
      touchesLockfiles: flags.lockfile,
      touchesAuthentication: flags.authentication,
      touchesProviderRuntime: flags.providerRuntime,
      touchesReleaseInfrastructure: flags.releaseInfra,
      touchesDatabase: flags.database,
      requiredSuites: [],
      autoMergeEligible: false,
      validatedHeadSha: input.validatedHeadSha ?? null,
      ignored: true,
    };
  }

  /** @type {RiskClass} */
  let riskClass = "low";

  if (flags.workflow) {
    riskClass = "sensitive";
    reasons.push("touches .github/workflows or actions");
  }
  if (flags.migration || flags.database) {
    riskClass = "sensitive";
    reasons.push("touches migrations or database schema");
  }
  if (flags.lockfile || flags.dependencyManifest) {
    riskClass = "sensitive";
    reasons.push("touches dependency manifests or lockfiles");
  }
  if (flags.authentication) {
    riskClass = "sensitive";
    reasons.push("touches authentication/secrets/permission code");
  }
  if (flags.providerRuntime) {
    riskClass = "sensitive";
    reasons.push("touches provider/runtime/plugin execution code");
  }
  if (flags.releaseInfra) {
    riskClass = "sensitive";
    reasons.push("touches release/installer/infra/deployment code");
  }
  if (flags.governance) {
    riskClass = "sensitive";
    reasons.push("touches governance or automation-control surfaces");
  }
  if (files.length >= LARGE_FILE_COUNT) {
    riskClass = "sensitive";
    reasons.push(`unusually large file count (${files.length} >= ${LARGE_FILE_COUNT})`);
  }
  if (commitCount >= LARGE_COMMIT_COUNT) {
    riskClass = "sensitive";
    reasons.push(`unusually large commit count (${commitCount} >= ${LARGE_COMMIT_COUNT})`);
  }

  // Unknown / non-docs residual paths that are not clearly docs-only → never low.
  if (riskClass === "low" && !flags.docsOnly) {
    // Engine/dashboard-only without other flags → medium (no auto-merge in initial rollout).
    if (flags.engine || flags.dashboard) {
      riskClass = "medium";
      reasons.push("localized product code change — medium during AUTO-2 rollout (no auto-merge)");
    } else {
      riskClass = "sensitive";
      reasons.push("ambiguous/unknown path classification — treated as sensitive");
    }
  }

  if (riskClass === "low" && flags.docsOnly) {
    reasons.push("docs-only / localized documentation change");
  }

  const requiredSuites = requiredSuitesFor(flags, riskClass);
  const autoMergeEligible = riskClass === "low";

  return {
    riskClass,
    reasons,
    changedFileCount: files.length,
    commitCount,
    touchesWorkflows: flags.workflow,
    touchesMigrations: flags.migration,
    touchesDependencies: flags.dependencyManifest,
    touchesLockfiles: flags.lockfile,
    touchesAuthentication: flags.authentication,
    touchesProviderRuntime: flags.providerRuntime,
    touchesReleaseInfrastructure: flags.releaseInfra,
    touchesDatabase: flags.database,
    requiredSuites,
    autoMergeEligible,
    validatedHeadSha: input.validatedHeadSha ?? null,
    ignored: false,
  };
}

/**
 * @param {string} reason
 * @param {string[]} files
 * @param {number} commitCount
 * @param {ReturnType<typeof aggregateFlags>} flags
 * @param {string|null|undefined} validatedHeadSha
 */
function blocked(reason, files, commitCount, flags, validatedHeadSha) {
  return {
    riskClass: /** @type {RiskClass} */ ("blocked"),
    reasons: [reason],
    changedFileCount: files.length,
    commitCount,
    touchesWorkflows: flags.workflow,
    touchesMigrations: flags.migration,
    touchesDependencies: flags.dependencyManifest,
    touchesLockfiles: flags.lockfile,
    touchesAuthentication: flags.authentication,
    touchesProviderRuntime: flags.providerRuntime,
    touchesReleaseInfrastructure: flags.releaseInfra,
    touchesDatabase: flags.database,
    requiredSuites: requiredSuitesFor(flags, "blocked"),
    autoMergeEligible: false,
    validatedHeadSha: validatedHeadSha ?? null,
    ignored: false,
  };
}

/**
 * @param {ReturnType<typeof classifyUpstream>} classification
 * @param {{ prNumber: number|string, headSha: string, baseRef: string, headRef: string, validationConclusion?: string }} meta
 */
export function buildAuto2ReportBody(classification, meta) {
  const lines = [
    REPORT_MARKER,
    `## AUTO-2 report`,
    ``,
    `| Field | Value |`,
    `| --- | --- |`,
    `| PR | #${meta.prNumber} |`,
    `| Head SHA | \`${meta.headSha}\` |`,
    `| Base | \`${meta.baseRef}\` |`,
    `| Head ref | \`${meta.headRef}\` |`,
    `| Risk | **${classification.riskClass.toUpperCase()}** |`,
    `| Auto-merge eligible | ${classification.autoMergeEligible ? "YES" : "NO"} |`,
    `| Changed files | ${classification.changedFileCount} |`,
    `| Commits | ${classification.commitCount} |`,
    `| Workflows | ${classification.touchesWorkflows ? "YES" : "NO"} |`,
    `| Migrations | ${classification.touchesMigrations ? "YES" : "NO"} |`,
    `| Dependencies | ${classification.touchesDependencies ? "YES" : "NO"} |`,
    `| Lockfiles | ${classification.touchesLockfiles ? "YES" : "NO"} |`,
    `| Auth | ${classification.touchesAuthentication ? "YES" : "NO"} |`,
    `| Provider/runtime | ${classification.touchesProviderRuntime ? "YES" : "NO"} |`,
    `| Release/infra | ${classification.touchesReleaseInfrastructure ? "YES" : "NO"} |`,
    `| Database | ${classification.touchesDatabase ? "YES" : "NO"} |`,
    `| Validated head | \`${classification.validatedHeadSha ?? meta.headSha}\` |`,
    `| Validation | ${meta.validationConclusion ?? "n/a"} |`,
    `| Host D deploy | NO (AUTO-3) |`,
    ``,
    `### Reasons`,
    ...(classification.reasons.length ? classification.reasons.map((r) => `- ${r}`) : ["- _none_"]),
    ``,
    `### Required suites`,
    ...(classification.requiredSuites.length
      ? classification.requiredSuites.map((s) => `- \`${s}\``)
      : ["- _none_"]),
    ``,
    `---`,
    `Trusted finalizer only. Candidate jobs never receive App credentials.`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * @param {string} headRef
 */
export function isAuto2ManagedHead(headRef) {
  return (
    headRef.startsWith("automation/upstream-") ||
    headRef.startsWith("auto2-proof/")
  );
}

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--") && i + 1 < argv.length) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage: auto2-classify-upstream.mjs --files-json <path> [--commits N] [--head-sha SHA] [--json]\n`);
    process.exit(0);
  }
  const { readFileSync } = await import("node:fs");
  const filesPath = String(args["files-json"] || "");
  if (!filesPath) {
    process.stderr.write("missing --files-json\n");
    process.exit(2);
  }
  const files = JSON.parse(readFileSync(filesPath, "utf8"));
  const result = classifyUpstream({
    changedFiles: files,
    commitCount: Number(args.commits || 0),
    validatedHeadSha: args["head-sha"] ? String(args["head-sha"]) : undefined,
    hasMergeConflict: args["merge-conflict"] === "true",
    requiredChecksFailed: args["checks-failed"] === "true",
    staleValidatedSha: args["stale-sha"] === "true",
    missingAppIdentity: args["missing-app"] === "true",
    isAutomationPr: args["non-automation"] === "true" ? false : true,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.riskClass === "blocked" ? 2 : 0);
}
