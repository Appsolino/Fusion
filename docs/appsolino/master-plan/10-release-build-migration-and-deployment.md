> **Status: Historical/reference**
> This document does not override `MASTER-PLAN.md`, `OPERATING-MODEL.md` or `CURRENT-STATE.md`.

# Release, Build, Migration, and Deployment

Last updated: 2026-07-29

## 1. Trusted release pipeline

```text
clean pinned source
→ clean dependency installation (frozen lockfile, private store)
→ full source tests
→ full package build
→ release manifest
→ packaged runtime tests   # FUSI-007 class
→ staging installation
→ migration compatibility test
→ staging restart + chaos tests
→ approval / promotion
→ pause new claims
→ pre-migration backup
→ migration under exclusive lease
→ atomic release activation
→ service restart
→ identity / readiness verification
→ resume claims
→ post-deployment observation
```

**Forbidden:** upstream tarball straight to production; surgical overlay as steady state; building on Host P.

## 2. Release manifest (minimum fields)

- Appsolino release version
- upstream base SHA
- Appsolino source SHA
- build timestamp (UTC)
- Node version; pnpm version
- lockfile hash
- migration-set hash
- maximum supported schema (`schemaMax`)
- CLI bundle hash; engine bundle hash; dashboard bundle hash
- plugin manifest hash
- compatibility: min/max schema; rollback-compatible release IDs
- builder ID / CI run URL

Store as `RELEASE_MANIFEST.json` (successor/companion to today’s `BUILD_COMPLETE.json` / `RELEASE_METADATA.json`).

## 3. Readiness must fail when

- database newer than binary (`StaleBinarySchemaError` class)
- migration required before accepting writes
- service and CLI resolve different release roots
- manifest missing/invalid
- compiled migration set ≠ manifest hash
- `current` symlink and activation record disagree
- controller/activation JSON disagrees with symlink (post-cutover)

Wire both: upstream `assertBinaryNotOlderThanDatabase` and Appsolino `release-schema-consistency`.

## 4. Activation authority (single)

One tool (lineage of `fusion-release` v2; explicit `activate` subcommand) must atomically:

1. verify artefact hashes
2. verify schemaMax ≥ applied (or migrate path selected)
3. write activation record
4. switch `current` symlink
5. update subordinate status JSON **to match**
6. restart service
7. verify readiness

Today’s mismatch (`status.json` vs live surgical symlink) is exactly what this forbids.

## 5. Migration and rollback policy

| Case | Action |
| --- | --- |
| Expand-only compatible | Migrate forward under lease; rollback binary allowed if schemaMax covers applied |
| Expand/contract requiring data rewrite | Multi-release expand→migrate→contract; no jump |
| Rollback to older schemaMax than applied | **Forbidden** — restore DB from pre-migration backup instead |
| Interrupted activation | Fail closed; leave previous `current` if symlink not switched; if switched, readiness must detect |

## 6. Packaged runtime proof (mandatory)

Minimum:

- Start packaged CLI against empty + migrated DBs
- `CentralCore.close` / layerless paths (FUSI-007)
- Dashboard boot
- `fn task list` after schema gate
- Contamination gate marker present in bundle when claimed
- No `backendHandle is only available in backend mode` on smoke paths

Source Vitest alone is insufficient (ISS-REL-004).

## 7. Pause claims / exclusive lease

During production migrate/activate:

- stop scheduler claims (durable flag)
- drain in-flight with timeout
- hold lease key in DB/lockdir
- migrate
- activate
- readiness
- clear pause

## 8. Acceptance evidence per failure class

| Failure prevented | Owner | Evidence |
| --- | --- | --- |
| Identity split | activator + readiness | staging disagreement tests |
| Binary < DB | schema gates | ISS-REL-002 repro must fail closed on service start |
| Packaged CLI break | packaged tests | FUSI-007 suite green on artefact |
| Bad rollback | policy engine | attempt blocked in staging |
| Surgical forever | retirement checklist | Phase 1+2 artefact live; surgical symlink gone |
