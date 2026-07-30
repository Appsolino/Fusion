# Provisioning design

- **Authoritative:** Ansible under `infra/ansible/`
- **Bootstrap:** `infra/cloud-init/staging-bootstrap.yaml` (minimal first boot)
- **Inventory:** local Host D (`inventory/staging.yml`)
- **Roles:** base, fusion_user, filesystem, node_toolchain, postgres_staging, monitoring, backup, acceptance, fusion_staging
- **Secrets:** `/etc/appsolino-fusion/staging/secrets.env` root:fusion 0640 (untracked); examples only in git
- **Idempotency:** second provision run recorded with `changed=0`
