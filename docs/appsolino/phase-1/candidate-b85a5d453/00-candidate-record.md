# Candidate record — Phase 1 Candidate A / A-P1

Date (UTC): 2026-07-29

## Candidates evaluated

| Label | Identity | Result |
|-------|----------|--------|
| Candidate A | Unchanged upstream `b85a5d4531df8fa749d77bf85ea4ab9ab960ce86` | **REJECTED** (packaged version identity only) |
| Candidate A-P1 | Upstream `b85a5d4531df8fa749d77bf85ea4ab9ab960ce86` + minimal packaging patch `a366fab379ca30322902d1bb4c040b8cd16262fb` | **ACCEPTED** |

## Accepted identity

```text
Candidate A-P1:
upstream b85a5d4531df8fa749d77bf85ea4ab9ab960ce86
+ minimal baseline packaging patch
a366fab379ca30322902d1bb4c040b8cd16262fb
```

## Product integration (closure)

| Field | Value |
|-------|-------|
| Appsolino `origin/main` tip at integration | `ee1284a2d2e8af981a29cff226fdb7f17094c511` |
| Evidence branch | `phase-1/candidate-b85a5d-a-p1` (tip must remain `a366fab379ca30322902d1bb4c040b8cd16262fb`) |
| Product integration branch | `phase-1/close-b85a5d-baseline` |
| Product integration commit | `82feb14b732dcd31176338d024b09e68c1646808` (cherry-pick `-x` of tested commit) |
| Declared / packaged version | `0.74.0-beta.5` |
| Node | `v22.23.1` |
| pnpm | `10.33.0` |

## Scope note

This is a **minimal baseline packaging patch**, not an Appsolino reliability re-land. No contamination gates, Phase 2 modules, FUSI-007, scheduler/executor/workflow, or schema reliability controls were included.
