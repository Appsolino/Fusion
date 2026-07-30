# Upstream assessment — 2026-07-30

**Verdict: DO NOT MERGE upstream into Appsolino `main` at this time.**

Assessment snapshot (evidence under `/srv/appsolino-fusion/phase-2a/evidence/upstream-assessment-2026-07-30/`):

| Field | Value |
| --- | --- |
| Assessment UTC | 2026-07-30T18:23:03Z |
| Appsolino `main` | `420544216a72b9233330b45a3a281ed17143d4c9` |
| Upstream `main` (assessment) | `bb8be93c525be399d97081da6eecd094a074b999` |
| Merge-base (pinned baseline) | `b85a5d4531df8fa749d77bf85ea4ab9ab960ce86` |
| Ahead (Appsolino commits not in upstream) | **29** |
| Behind (upstream commits not in Appsolino) | **222** |
| Trial merge (`upstream/main` into Appsolino `main`) | `merge_exit=0`, **conflicted_paths=0** |
| Textual conflict markers in merge-tree probe | **0** |

A later same-day recalculation saw upstream tip advance (`29186a96d…`, behind **223**). Numbers below use the assessment snapshot unless noted.

## Versions and toolchain

| Item | Appsolino | Upstream |
| --- | --- | --- |
| Package version | `0.74.0-beta.5` | `0.74.0-beta.5` |
| `packageManager` | `pnpm@10.33.0` | `pnpm@10.33.0` |
| Default CI Node (setup-node-pnpm) | `24` | same family (shared history) |

No `.nvmrc` / `engines` field on either tip at assessment time.

## Migration ceiling

| Side | Max numbered SQL migration |
| --- | --- |
| Appsolino | **0036** (`0036_chat_session_tags.sql`) |
| Upstream | **0037** (`0037_drop_global_concurrency.sql`) |

Upstream-only migration `0037_drop_global_concurrency.sql` must be reviewed before any controlled sync. Production/staging backup before applying is mandatory when that sync is eventually attempted.

## File overlap (merge-base deltas)

Intersection of files changed on both sides since merge-base (`merge-base..origin/main` ∩ `merge-base..upstream/main`):

| Metric | Count |
| --- | ---: |
| Appsolino-changed files | 174 |
| Upstream-changed files | 564 (recalc; assessment-era similar order) |
| Overlap files | **1** |

### Overlap list

- `packages/engine/src/executor.ts` — **sensitive** (executor / runtime path)

### Sensitive overlaps

Only the executor path above appears in the delta intersection. That file also differs by blob at both tips (Correction B).

## Runtime / package overlaps beyond delta intersection

Correction A (install scripts) — **Appsolino-only** (missing on upstream):

- `infra/scripts/install-staging-release.sh`
- `infra/scripts/test-install-staging-permissions.sh`

Correction B — files **exist on both tips with different blobs** (semantic re-check required even when not both-side-delta):

| Path | Same blob? |
| --- | --- |
| `packages/engine/src/providers/mock-provider.ts` | NO |
| `packages/engine/src/transient-error-detector.ts` | NO |
| `packages/engine/src/executor.ts` | NO |
| `packages/engine/src/__tests__/mock-provider.test.ts` | NO |
| `packages/engine/src/__tests__/transient-error-detector.test.ts` | NO |
| `packages/engine/src/__tests__/executor-graph-requeue-gate.test.ts` | NO |

## Conflicts with PR #12 / #13 surfaces

PR #12/#13 / Correction A+B surfaces:

- Install scripts: Appsolino-only vs upstream missing — sync must preserve Appsolino install behaviour.
- Mock provider / transient-error detector / executor (+ tests): dual existence, divergent blobs — merge may be textually clean yet **semantically wrong** without a dedicated re-check.
- Trial merge reported **0** textual conflicted paths; that does **not** mean Correction B is safe to auto-accept.

## Expected validation cost

**HIGH**

Drivers:

1. **222** upstream commits behind Appsolino `main`.
2. New upstream migration **0037** (`drop_global_concurrency`).
3. Correction B semantic re-check (executor / mock provider / transient-error detector).
4. Full Level B/C packaging and staging smoke if a controlled sync PR is opened later.

## Recommendation

**DO NOT MERGE** upstream into Appsolino `main` now.

Continue daily development on Appsolino `main`. Keep intentional sync for a dedicated `sync/upstream-YYYY-MM-DD` PR after migration and Correction B review. Use automated **`upstream-shadow`** monitoring only (see `UPSTREAM-MONITORING.md`) — observational force-push tip, never an auto-merge into `main`.
