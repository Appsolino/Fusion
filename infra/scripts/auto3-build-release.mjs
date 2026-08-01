#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoAuto3 2026-08-01-01:20:
 * Credential-free AUTO-3 build helper. Produces one immutable release archive +
 * manifest from an exact Appsolino main SHA. No Host D SSH keys, no deploy
 * secrets, no production credentials. May run packaging checks and frozen
 * lockfile installs only.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  admitSourceSha,
  gitIsAncestorOfMain,
  gitRevParse,
  validateManifestShape,
} from "./auto3-guards.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * @param {string} filePath
 */
function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * @param {string} dir
 * @param {string[]} [acc]
 * @param {string} [base]
 */
function listFiles(dir, acc = [], base = dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) listFiles(p, acc, base);
    else acc.push(relative(base, p).split("\\").join("/"));
  }
  return acc.sort();
}

/**
 * @param {string} distDir
 */
function treeDigest(distDir) {
  const files = listFiles(distDir);
  const hash = createHash("sha256");
  for (const rel of files) {
    const full = join(distDir, rel);
    const st = statSync(full);
    const mode = (st.mode & 0o777).toString(8).padStart(4, "0");
    hash.update(`${rel}\0${mode}\0${sha256File(full)}\n`);
  }
  return { digest: hash.digest("hex"), files };
}

/**
 * @param {string} migrationsDir
 */
function migrationSetSha256(migrationsDir) {
  if (!existsSync(migrationsDir)) return createHash("sha256").update("").digest("hex");
  const names = readdirSync(migrationsDir).filter((n) => /^\d+/.test(n)).sort();
  const hash = createHash("sha256");
  for (const n of names) hash.update(`${n}\n`);
  return hash.digest("hex");
}

/**
 * @param {string} migrationsDir
 */
function schemaCeiling(migrationsDir) {
  if (!existsSync(migrationsDir)) return "none";
  const nums = readdirSync(migrationsDir)
    .map((n) => n.match(/^(\d+)/)?.[1])
    .filter(Boolean)
    .map((n) => Number(n));
  if (!nums.length) return "none";
  return String(Math.max(...nums)).padStart(4, "0");
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
function run(args, env = process.env) {
  const [cmd, ...rest] = args;
  const r = spawnSync(cmd, rest, { encoding: "utf8", env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  return r;
}

/**
 * Scan for credential-looking strings in packaged text files (fail closed on common secret markers).
 * @param {string} distDir
 */
function assertNoCredentialsInTree(distDir) {
  const forbidden = [
    /BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY/,
    /APPSOLINO_AUTOMATION_APP_PRIVATE_KEY/,
    /HOST_D_DEPLOY_SSH_KEY/,
    /ghp_[A-Za-z0-9]{20,}/,
    /github_pat_[A-Za-z0-9_]{20,}/,
  ];
  const files = listFiles(distDir);
  for (const rel of files) {
    if (/\.(png|jpg|jpeg|gif|webp|wasm|node|so|dylib|bin)$/i.test(rel)) continue;
    if (rel === "fn" || rel.endsWith("/fn")) continue;
    const full = join(distDir, rel);
    const st = statSync(full);
    if (st.size > 2_000_000) continue;
    let text;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    for (const re of forbidden) {
      if (re.test(text)) {
        throw new Error(`credentials-like content in packaged file: ${rel}`);
      }
    }
    if (text.includes("/srv/appsolino-fusion/worktrees/") || text.includes("FUSION_HOME=/home/")) {
      // soft: source worktree paths as deployment dependencies
      if (rel.endsWith(".sh") || rel.endsWith(".env")) {
        throw new Error(`source worktree path embedded in packaged dependency: ${rel}`);
      }
    }
  }
}

/**
 * @param {object} input
 * @param {string} input.sourceSha
 * @param {string} [input.sourcePr]
 * @param {string} [input.deploymentReason]
 * @param {string} [input.outDir]
 * @param {boolean} [input.skipBuild]
 * @param {string} [input.distDir]
 * @param {boolean} [input.fromPrHeadOnly]
 * @param {string} [input.expectedMergedSha]
 * @param {string} [input.previousCompatibleRelease]
 * @param {boolean} [input.allowMissingMain] — tests only
 */
export async function buildAuto3Release(input) {
  const sourceSha = String(input.sourceSha || "").trim().toLowerCase();
  const outDir = resolve(input.outDir || join(ROOT, "artifacts/auto3"));
  mkdirSync(outDir, { recursive: true });

  if (!input.allowMissingMain) {
    const tip = gitRevParse(ROOT, "origin/main");
    const ancestor = gitIsAncestorOfMain(ROOT, sourceSha, "origin/main");
    const admission = admitSourceSha({
      sourceSha,
      mainTipSha: tip,
      isAncestorOfMain: ancestor,
      fromPrHeadOnly: input.fromPrHeadOnly === true,
      expectedMergedSha: input.expectedMergedSha,
    });
    if (!admission.admitted) {
      return { ok: false, status: "BLOCKED", reasons: admission.reasons, outDir };
    }
  }

  if (!input.skipBuild) {
    const install = run(["pnpm", "install", "--frozen-lockfile"]);
    if (install.status !== 0) {
      throw new Error(`pnpm install failed: ${install.stderr || install.stdout}`);
    }
    const build = run(["pnpm", "build:exe"]);
    if (build.status !== 0) {
      throw new Error(`pnpm build:exe failed: ${build.stderr || build.stdout}`);
    }
    const perm = run(["bash", "infra/scripts/test-install-staging-permissions.sh"]);
    if (perm.status !== 0) {
      throw new Error(`Correction A permission fixture failed: ${perm.stderr || perm.stdout}`);
    }
  }

  const distDir = resolve(input.distDir || join(ROOT, "packages/cli/dist"));
  const fnPath = join(distDir, "fn");
  if (!existsSync(fnPath) || !statSync(fnPath).isFile()) {
    throw new Error(`missing packaged executable: ${fnPath}`);
  }
  if ((statSync(fnPath).mode & 0o111) === 0) {
    throw new Error("executable mode mismatch: fn is not executable");
  }

  const ver = run([fnPath, "--version"]);
  const applicationVersion = (ver.stdout || "").trim().split("\n")[0]?.replace(/\r/g, "") || "";
  if (!applicationVersion) throw new Error("packaged binary failed --version");

  // Isolated temp start (help only — full dashboard needs DB; CI build stays credential-free)
  const help = run([fnPath, "--help"], {
    ...process.env,
    HOME: join(outDir, "tmp-home"),
    FUSION_HOME: join(outDir, "tmp-fusion-home"),
  });
  if (help.status !== 0) {
    throw new Error(`packaged binary failed isolated --help: ${help.stderr || help.stdout}`);
  }

  const cursorPlugin = join(distDir, "plugins/fusion-plugin-cursor-runtime/package.json");
  if (!existsSync(cursorPlugin)) {
    throw new Error("bundled Cursor runtime plugin missing from package");
  }

  assertNoCredentialsInTree(distDir);

  const exeSha = sha256File(fnPath);
  const { digest, files } = treeDigest(distDir);
  const migSha = migrationSetSha256(join(distDir, "migrations"));
  const ceiling = schemaCeiling(join(distDir, "migrations"));
  const short = sourceSha.slice(0, 12);
  const releaseId = `auto3-${applicationVersion}-${short}`;

  const stageDir = join(outDir, `stage-${short}`);
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  // Copy only install-relevant trees (escape-safe: no absolute paths in archive)
  for (const name of ["fn", "client", "migrations", "plugins", "runtime"]) {
    const src = join(distDir, name);
    if (!existsSync(src)) continue;
    const r = run(["cp", "-a", src, join(stageDir, name)]);
    if (r.status !== 0) throw new Error(`cp failed for ${name}: ${r.stderr}`);
  }

  const archiveName = `${releaseId}.tar.gz`;
  const archivePath = join(outDir, archiveName);
  await new Promise((resolveP, reject) => {
    const tar = spawnSync(
      "tar",
      ["-czf", archivePath, "-C", stageDir, "."],
      { encoding: "utf8" },
    );
    if (tar.status !== 0) reject(new Error(`tar failed: ${tar.stderr || tar.stdout}`));
    else resolveP(undefined);
  });

  // Extraction escape check into disposable dir
  const extractProbe = join(outDir, `extract-probe-${short}`);
  rmSync(extractProbe, { recursive: true, force: true });
  mkdirSync(extractProbe, { recursive: true });
  const xt = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
  if (xt.status !== 0) throw new Error("archive listing failed");
  for (const line of xt.stdout.split("\n")) {
    const e = line.trim();
    if (!e) continue;
    if (e.startsWith("/") || e.includes("..")) {
      throw new Error(`archive extraction escape path: ${e}`);
    }
  }
  const xr = spawnSync("tar", ["-xzf", archivePath, "-C", extractProbe], { encoding: "utf8" });
  if (xr.status !== 0) throw new Error(`archive extract failed: ${xr.stderr}`);

  const archiveSha = sha256File(archivePath);
  const nodeVersion = process.version.replace(/^v/, "");
  const pnpmV = run(["pnpm", "--version"]);
  const pnpmVersion = (pnpmV.stdout || "").trim();

  /** @type {Record<string, unknown>} */
  const manifest = {
    sourceSha,
    sourcePr: input.sourcePr ?? null,
    deploymentReason: input.deploymentReason ?? "manual",
    applicationVersion,
    releaseId,
    buildUtc: new Date().toISOString(),
    nodeVersion,
    pnpmVersion,
    executableSha256: exeSha,
    archiveSha256: archiveSha,
    migrationSetSha256: migSha,
    packagedTreeDigest: digest,
    packagedFileCount: files.length,
    expectedHealthVersion: applicationVersion,
    requiredSchemaCeiling: ceiling,
    previousCompatibleRelease: input.previousCompatibleRelease ?? null,
    archiveName,
    hostPForbidden: true,
  };

  const shape = validateManifestShape(manifest);
  if (!shape.ok) throw new Error(shape.reasons.join("; "));

  const manifestPath = join(outDir, `${releaseId}.manifest.json`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // Re-hash archive after write is unchanged
  if (sha256File(archivePath) !== archiveSha) {
    throw new Error("archive hash drifted after packaging");
  }

  return {
    ok: true,
    status: "BUILT",
    reasons: [],
    outDir,
    archivePath,
    manifestPath,
    manifest,
  };
}

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skip-build") out.skipBuild = true;
    else if (a === "--json") out.json = true;
    else if (a === "--allow-missing-main") out.allowMissingMain = true;
    else if (a === "--from-pr-head-only") out.fromPrHeadOnly = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--") && i + 1 < argv.length) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args["source-sha"]) {
    process.stdout.write(
      "Usage: auto3-build-release.mjs --source-sha SHA [--source-pr N] [--deployment-reason R] [--out-dir DIR] [--skip-build] [--dist-dir DIR] [--json]\n",
    );
    process.exit(args.help ? 0 : 2);
  }
  buildAuto3Release({
    sourceSha: String(args["source-sha"]),
    sourcePr: args["source-pr"] ? String(args["source-pr"]) : undefined,
    deploymentReason: args["deployment-reason"] ? String(args["deployment-reason"]) : undefined,
    outDir: args["out-dir"] ? String(args["out-dir"]) : undefined,
    skipBuild: args.skipBuild === true,
    distDir: args["dist-dir"] ? String(args["dist-dir"]) : undefined,
    fromPrHeadOnly: args.fromPrHeadOnly === true,
    expectedMergedSha: args["expected-merged-sha"] ? String(args["expected-merged-sha"]) : undefined,
    previousCompatibleRelease: args["previous-compatible-release"]
      ? String(args["previous-compatible-release"])
      : undefined,
    allowMissingMain: args.allowMissingMain === true,
  })
    .then((result) => {
      if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else process.stdout.write(`${result.status} release=${result.manifest?.releaseId ?? "-"}\n`);
      process.exit(result.ok ? 0 : 2);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
