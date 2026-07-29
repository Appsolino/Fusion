# Phase 1 — Minimal packaging patch

## Tested evidence commit

- SHA: `a366fab379ca30322902d1bb4c040b8cd16262fb`
- Message: `fix(cli): embed version identity in standalone executable`
- Parent: `b85a5d4531df8fa749d77bf85ea4ab9ab960ce86`
- Patch sha256 (`git diff --binary` parent..commit): `9dcb0edc1a8f6b851205912d227dec636559ac2bff04da5f7c69bfd3c78fe1ea`

## Product integration commit

- SHA: `82feb14b732dcd31176338d024b09e68c1646808`
- Created by: `git cherry-pick -x a366fab379ca30322902d1bb4c040b8cd16262fb` onto Appsolino `origin/main`
- Patch equivalence vs accepted Phase 1B patch: **PASS** (identical sha256 `9dcb0edc1a8f6b851205912d227dec636559ac2bff04da5f7c69bfd3c78fe1ea`)

## Files changed (exact)

1. `packages/cli/src/version-identity.ts` (new)
2. `packages/cli/src/__tests__/version-identity.test.ts` (new)
3. `packages/cli/src/bin.ts`
4. `packages/cli/build.ts`
5. `packages/dashboard/src/cli-package-version.ts`
6. `packages/dashboard/src/__tests__/cli-package-version.test.ts`
7. `packages/dashboard/src/index.ts`

## Diffstat

```text
14	0	packages/cli/build.ts
63	0	packages/cli/src/__tests__/version-identity.test.ts
10	0	packages/cli/src/bin.ts
87	0	packages/cli/src/version-identity.ts
42	1	packages/dashboard/src/__tests__/cli-package-version.test.ts
39	0	packages/dashboard/src/cli-package-version.ts
1	1	packages/dashboard/src/index.ts
```

## Not changed

- `packages/cli/package.json` version remains `0.74.0-beta.5`
- `pnpm-lock.yaml` unchanged
- Migration files unchanged
- No Appsolino reliability modules
- No workflow/scheduler/provider/FUSI-007 changes
