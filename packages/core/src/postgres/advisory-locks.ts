import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type AdvisoryLockTransaction = Pick<PostgresJsDatabase<Record<string, never>>, "execute">;

/**
 * Serialize schema DDL behind any active SQLite cutover transaction.
 *
 * SQLite migration takes `fusion:sqlite-migration-state` before it reads the
 * target schema. Schema application and runtime plugin DDL must take the same
 * lock first, then their narrower schema lock, so PostgreSQL never sees the
 * inverse DDL/read lock order that can deadlock concurrent project startup.
 */
export async function acquireSqliteMigrationStateLock(tx: AdvisoryLockTransaction): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fusion:sqlite-migration-state'))`);
}

export async function acquireSchemaMutationLocks(tx: AdvisoryLockTransaction): Promise<void> {
  await acquireSqliteMigrationStateLock(tx);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fusion:schema-applier'))`);
}

import postgres from "postgres";
import { looksLikePoolerUrl } from "./backend-resolver.js";

export class PlanningLifecycleLockTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanningLifecycleLockTransportError";
  }
}

/**
 * FNXC:PlanningDependencyReseed 2026-08-04-00:43:
 * Planning handoff and dependency re-seed cross processes, so their outer lock
 * is a dedicated PostgreSQL session rather than the TaskStore's local mutex.
 * Never use the runtime pool: a transaction pooler can change sessions between
 * lock and unlock and silently defeat session advisory locking.
 */
export async function withPlanningLifecycleAdvisoryLock<T>(
  input: {
    projectId: string;
    taskId: string;
    directSessionUrl: string | null;
    provenance: "embedded-lifecycle" | "migration-override" | null;
    runtimeUrl?: string | null;
    migrationUrl?: string | null;
  },
  callback: () => Promise<T>,
): Promise<T> {
  const directUrl = input.directSessionUrl;
  if (!directUrl || !input.provenance || looksLikePoolerUrl(directUrl)) {
    throw new PlanningLifecycleLockTransportError("Planning lifecycle lock requires a direct PostgreSQL session endpoint");
  }

  let directDatabase: string;
  try {
    directDatabase = decodeURIComponent(new URL(directUrl).pathname.replace(/^\//, ""));
  } catch {
    throw new PlanningLifecycleLockTransportError("Planning lifecycle lock has an invalid direct PostgreSQL session endpoint");
  }
  if (!directDatabase) {
    throw new PlanningLifecycleLockTransportError("Planning lifecycle lock direct endpoint must select a database");
  }
  const descriptorEndpoint = input.provenance === "embedded-lifecycle"
    ? input.runtimeUrl
    : input.migrationUrl;
  if (!descriptorEndpoint || descriptorEndpoint !== directUrl) {
    throw new PlanningLifecycleLockTransportError("Planning lifecycle lock endpoint does not match the resolved backend descriptor");
  }
  const operationalUrl = input.runtimeUrl ?? input.migrationUrl;
  if (operationalUrl) {
    try {
      const operationalDatabase = decodeURIComponent(new URL(operationalUrl).pathname.replace(/^\//, ""));
      if (!operationalDatabase || operationalDatabase !== directDatabase) {
        throw new PlanningLifecycleLockTransportError("Planning lifecycle lock endpoint selects a different database than the resolved backend");
      }
    } catch (error) {
      if (error instanceof PlanningLifecycleLockTransportError) throw error;
      throw new PlanningLifecycleLockTransportError("Resolved backend has an invalid PostgreSQL endpoint");
    }
  }

  const client = postgres(directUrl, { max: 1, prepare: false, onnotice: () => {} });
  const key = `fusion:planning-lifecycle:${input.projectId}:${input.taskId}`;
  let acquired = false;
  try {
    /*
    FNXC:PlanningDependencyReseed 2026-08-04-00:54:
    URL shape is not proof of the connected target. Verify the session-selected
    database before locking so an accidental migration endpoint cannot serialize
    one database while task writes target another.
    */
    const identity = await client<{ database: string; host: string | null; port: number | null; cluster: string | null }[]>`
      SELECT current_database() AS database,
             inet_server_addr()::text AS host,
             inet_server_port() AS port,
             current_setting('cluster_name', true) AS cluster
    `;
    if (identity[0]?.database !== directDatabase) {
      throw new PlanningLifecycleLockTransportError("Planning lifecycle lock session selected an unexpected database");
    }

    /*
    FNXC:PlanningDependencyReseed 2026-08-04-01:04:
    A database name identifies neither a PostgreSQL server nor an advisory-lock
    namespace. Compare the resolved operational connection's server identity
    with the dedicated direct session so a migration URL aimed at another
    cluster with the same database cannot serialize the wrong task lifecycle.
    */
    if (operationalUrl && operationalUrl !== directUrl) {
      const operationalClient = postgres(operationalUrl, { max: 1, prepare: false, onnotice: () => {} });
      try {
        const operationalIdentity = await operationalClient<{ database: string; host: string | null; port: number | null; cluster: string | null }[]>`
          SELECT current_database() AS database,
                 inet_server_addr()::text AS host,
                 inet_server_port() AS port,
                 current_setting('cluster_name', true) AS cluster
        `;
        const expected = operationalIdentity[0];
        const actual = identity[0];
        if (!expected || !actual
          || expected.database !== actual.database
          || expected.host !== actual.host
          || expected.port !== actual.port
          || (expected.cluster && actual.cluster && expected.cluster !== actual.cluster)) {
          throw new PlanningLifecycleLockTransportError("Planning lifecycle lock endpoint targets a different PostgreSQL server than the resolved backend");
        }
      } catch (error) {
        if (error instanceof PlanningLifecycleLockTransportError) throw error;
        throw new PlanningLifecycleLockTransportError("Planning lifecycle lock could not verify the resolved backend server identity");
      } finally {
        await operationalClient.end({ timeout: 5 }).catch(() => undefined);
      }
    }
    await client`SELECT pg_advisory_lock(hashtext(${key}))`;
    acquired = true;
    return await callback();
  } finally {
    if (acquired) await client`SELECT pg_advisory_unlock(hashtext(${key}))`.catch(() => undefined);
    await client.end({ timeout: 5 }).catch(() => undefined);
  }
}
