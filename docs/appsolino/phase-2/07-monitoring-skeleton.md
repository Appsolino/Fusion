# Monitoring skeleton

## Health semantics (corrected)

- `/usr/local/sbin/staging-health-check.sh` writes Prometheus + JSON atomically, then exits **non-zero** when composite health is false.
- Migration check queries `public.fusion_schema_migrations` and requires `max(version) == 0036`.
- Acceptance check parses `acceptance-result.json` and requires every ACC-ENV-03..08 result to be `PASS`, rejecting missing/malformed/stale files.

## Negative proofs

`staging-health-negative-tests.sh` proves non-zero exit for:

- bad version
- inactive service
- database failure
- migration mismatch

Evidence: `evidence/35-health-negative-results.json` (**PASS**).

## Mechanism

- Textfile: `/var/lib/node_exporter/textfile_collector/appsolino_fusion_staging.prom`
- Timer: `fusion-staging-health.timer`
- No public monitoring ports
