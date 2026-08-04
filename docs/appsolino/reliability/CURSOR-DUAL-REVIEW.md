# Steward dual independent review (Cursor-only)

**Status:** IMPLEMENTED (gates OFF) — replaces prior xAI/Grok draft  
**Parent:** [`STEWARD-POLICY.md`](STEWARD-POLICY.md)

## Roles

| Role | Provider | Model | Authority |
| --- | --- | --- | --- |
| Implementer | cursor-cli | composer-2.5 | write only inside isolated worktree |
| Reviewer | cursor-cli | composer-2.5 | read-only; fresh session; no write token |
| Approver | cursor-cli | composer-2.5 | read-only; separate fresh session |

xAI / Grok is **not required**. Issue #79 is superseded (NOT PLANNED).

## Controls

- Separate session IDs and request IDs for reviewer vs approver
- No shared implementer transcript into review/approve
- No GitHub App / Host D / Host P credentials in review children
- Exact head + diff SHA-256 + tests SHA-256 pinned in verdicts
- Any new candidate commit invalidates both verdicts
- Trusted App writer re-fetches PR and revalidates before `--match-head-commit`

## Activation

Keep `activation-policy.json` gates OFF until this path is merged and manually proven.
