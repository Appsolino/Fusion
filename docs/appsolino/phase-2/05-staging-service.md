# Staging service

## Unit (corrected)

- Name: `fusion-staging.service`
- `EnvironmentFile=` (mandatory) for `fusion.env` and `secrets.env` — no optional `-` form for secrets
- `ExecStartPre=/usr/local/sbin/staging-prestart-validate.sh` asserts:
  - secrets exist with `root:fusion` and mode `0640`/`0600`
  - `DATABASE_URL` role/db `fusion_staging` on `127.0.0.1`
  - no production markers
- Documentation URL is a stable GitHub docs reference (not a Host D worktree path)
- `UMask=0027`, `NoNewPrivileges=no`, `ProtectSystem=off`

## Immutable release install

- `/usr/local/sbin/install-staging-release.sh` never `rm -rf`s an existing named release
- Matching identity/hashes → `IDEMPOTENT_NOOP`
- Differing identity → `IMMUTABLE_CONFLICT` (exit 2)
- New installs stage in a sibling directory then rename

## Package

- Release: `phase2a-0.74.0-beta.5-040b61e8873e`
- Version: `0.74.0-beta.5`
- Executable SHA-256: `54e2cd933281ca523e57303c578c4e14b60cd5914006fac8c9145703a39a0c48`
- Listener: `127.0.0.1:4140` only
