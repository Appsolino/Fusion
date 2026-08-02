#!/usr/bin/env node
/* eslint-env node */
/**
 * FNXC:AppsolinoStewardS0 2026-08-01-21:10:
 * Issue upsert deduplication by fingerprint marker + occurrence id.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectFromFixture } from "../collect-evidence.mjs";
import {
  createMemoryIssueClient,
  upsertIncident,
  bodyIncludesOccurrence,
} from "../upsert-incident.mjs";
import { extractFingerprintFromIssueBody as extractFp } from "../policy.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("incident deduplication", () => {
  it("creates one issue per fingerprint; duplicate occurrence is noop", async () => {
    const client = createMemoryIssueClient();
    const { normalized } = collectFromFixture(join(FIXTURES, "version-drift"));
    const first = await upsertIncident(client, normalized);
    assert.equal(first.action, "create");
    assert.equal(client.issues.length, 1);
    const fp = extractFp(client.issues[0].body);
    assert.equal(fp, normalized.fingerprint);

    const second = await upsertIncident(client, normalized);
    assert.equal(second.action, "noop-duplicate-occurrence");
    assert.equal(client.issues.length, 1);
  });

  it("different occurrence same fingerprint appends once", async () => {
    const client = createMemoryIssueClient();
    const a = collectFromFixture(join(FIXTURES, "version-drift")).normalized;
    await upsertIncident(client, a);

    const b = collectFromFixture(join(FIXTURES, "version-drift")).normalized;
    b.instance = {
      ...b.instance,
      occurrenceId: "workflow-run:30705088926:attempt:1",
      runId: "30705088926",
    };
    const append = await upsertIncident(client, b);
    assert.equal(append.action, "append");
    assert.equal(client.issues.length, 1);
    assert.ok(bodyIncludesOccurrence(client.issues[0].body, a.instance.occurrenceId));
    assert.ok(bodyIncludesOccurrence(client.issues[0].body, b.instance.occurrenceId));
  });

  it("success fixture creates no issue", async () => {
    const client = createMemoryIssueClient();
    const { normalized } = collectFromFixture(join(FIXTURES, "success"));
    const r = await upsertIncident(client, normalized);
    assert.equal(r.action, "skip-no-incident");
    assert.equal(client.issues.length, 0);
  });

  it("reopens closed fingerprint on recurrence", async () => {
    const client = createMemoryIssueClient();
    const { normalized } = collectFromFixture(join(FIXTURES, "yaml-parse"));
    await upsertIncident(client, normalized);
    client.issues[0].state = "closed";

    const again = {
      ...normalized,
      instance: {
        ...normalized.instance,
        occurrenceId: "workflow-run:30690000099:attempt:1",
        runId: "30690000099",
      },
    };
    const r = await upsertIncident(client, again);
    assert.equal(r.action, "reopen-and-append");
    assert.equal(client.issues[0].state, "open");
  });
});
