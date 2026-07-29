# Monitoring skeleton

Phase 2A does **not** install Prometheus/Grafana on Host D.

## Mechanism

- Health script writes machine-readable status to:
  `/var/lib/node_exporter/textfile_collector/appsolino_fusion_staging.prom`
- Also JSON status via health-check stdout / staging state files
- systemd timer `fusion-staging-health.timer` invokes the check periodically

## Recorded fields (minimum)

- service up / health status
- reported version (`0.74.0-beta.5`)
- restart count / process RSS
- disk free
- database connectivity
- backup age / latest backup status (when dumps present)
- latest acceptance-test result (acceptance-result.json)

## Network

No monitoring ports exposed publicly.

## Evidence

`evidence/14-monitoring.prom`, `evidence/13-health-check.log`
