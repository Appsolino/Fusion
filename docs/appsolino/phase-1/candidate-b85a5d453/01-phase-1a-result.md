# Phase 1A — Unchanged upstream Candidate A

Upstream SHA: `b85a5d4531df8fa749d77bf85ea4ab9ab960ce86` (`0.74.0-beta.5`)

## Gate summary

| Gate | Result |
|------|--------|
| Frozen dependency install | PASS |
| Complete source build (`build:full`) | PASS |
| Complete executable package (`build:exe`) | PASS |
| Packaged CLI help | PASS |
| Packaged dashboard startup (localhost) | PASS |
| Task list / show / activity (staging) | PASS |
| Migration identity | PASS |
| Controlled restart | PASS |
| Packaged CLI `--version` | **FAIL** → `unknown` |
| `/api/health` version | **FAIL** → `0.0.0` |

## Decision

**REJECTED** — only for packaged version identity. All other packaged-runtime smoke gates passed.

Candidate A workspace was left unmodified for audit; Phase 1B used a separate tree.
