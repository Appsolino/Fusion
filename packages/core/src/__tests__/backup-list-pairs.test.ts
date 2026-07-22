/**
 * Regression coverage for BackupManager.listBackupPairs after the PostgreSQL
 * dump listing fix (PR #1).
 *
 * Product contract (SqliteFinalRemoval): PostgreSQL dump pairs supersede the
 * removed SQLite file-copy scanner. Leftover `.db` files in the backup
 * directory must not appear in listBackupPairs, whether or not dump pairs
 * exist. Tests write only under a disposable temp directory.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupManager } from "../backup.js";

describe("BackupManager.listBackupPairs", () => {
  let tempDir: string;
  let fusionDir: string;
  let backupDirPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "fusion-backup-list-pairs-"));
    fusionDir = join(tempDir, "project", ".fusion");
    backupDirPath = join(fusionDir, "backups");
    mkdirSync(backupDirPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function manager(): BackupManager {
    return new BackupManager(fusionDir, {
      connectionString: "postgresql://user:secret@127.0.0.1:55432/fusion",
      backupDir: ".fusion/backups",
    });
  }

  function writeDump(name: string, contents = "dump"): void {
    writeFileSync(join(backupDirPath, name), contents);
  }

  it("lists a project-only PostgreSQL dump", async () => {
    writeDump("fusion-pg-2026-07-01-120000.dump");
    const pairs = await manager().listBackupPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.timestamp).toBe("2026-07-01-120000");
    expect(pairs[0]?.project?.filename).toBe("fusion-pg-2026-07-01-120000.dump");
    expect(pairs[0]?.central).toBeUndefined();
  });

  it("lists a central-only PostgreSQL dump", async () => {
    writeDump("fusion-central-pg-2026-07-01-130000.dump");
    const pairs = await manager().listBackupPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.timestamp).toBe("2026-07-01-130000");
    expect(pairs[0]?.central?.filename).toBe("fusion-central-pg-2026-07-01-130000.dump");
    expect(pairs[0]?.project).toBeUndefined();
  });

  it("lists a paired project + central dump once", async () => {
    writeDump("fusion-pg-2026-07-01-140000.dump");
    writeDump("fusion-central-pg-2026-07-01-140000.dump");
    const pairs = await manager().listBackupPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.project?.filename).toBe("fusion-pg-2026-07-01-140000.dump");
    expect(pairs[0]?.central?.filename).toBe("fusion-central-pg-2026-07-01-140000.dump");
  });

  it("sorts pairs by timestamp descending", async () => {
    writeDump("fusion-pg-2026-07-01-100000.dump");
    writeDump("fusion-pg-2026-07-02-100000.dump");
    writeDump("fusion-pg-2026-07-01-150000.dump");
    const pairs = await manager().listBackupPairs();
    expect(pairs.map((p) => p.timestamp)).toEqual([
      "2026-07-02-100000",
      "2026-07-01-150000",
      "2026-07-01-100000",
    ]);
  });

  it("ignores filenames that are not PostgreSQL dump pairs", async () => {
    writeDump("not-a-backup.dump");
    writeDump("fusion-2026-07-01-160000.dump");
    writeDump("fusion-central-2026-07-01-160000.dump");
    writeDump("fusion-pg-2026-07-01-160000.dump");
    const pairs = await manager().listBackupPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.timestamp).toBe("2026-07-01-160000");
  });

  it("returns empty when no PostgreSQL dumps exist (no SQLite fallback)", async () => {
    writeDump("fusion-2026-07-01-120000.db", "sqlite-leftover");
    writeDump("fusion-central-2026-07-01-120000.db", "sqlite-leftover");
    const pairs = await manager().listBackupPairs();
    expect(pairs).toEqual([]);
  });

  it("intentionally hides leftover SQLite .db files when PostgreSQL dumps exist", async () => {
    writeDump("fusion-pg-2026-07-01-170000.dump");
    writeDump("fusion-2026-07-01-170000.db", "sqlite-leftover");
    writeDump("fusion-central-2026-07-01-170000.db", "sqlite-leftover");
    const pairs = await manager().listBackupPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.project?.filename).toBe("fusion-pg-2026-07-01-170000.dump");
    expect(pairs.some((p) => p.project?.filename.endsWith(".db"))).toBe(false);
    expect(pairs.some((p) => p.central?.filename.endsWith(".db"))).toBe(false);
  });
});
