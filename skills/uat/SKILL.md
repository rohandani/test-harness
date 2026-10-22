---
name: uat
description: Discover existing test assets, propose inferred UAT cases, and drive UAT contract versioning, approval, and locking.
---

# UAT Skill

Orchestrates UAT discovery, generation, and the DRAFT → APPROVED → LOCKED
approval gate for the AI Transformation Validator.

> Stub created by task 1.1. Full behavior is authored in task 19.1.

## Purpose

Discover existing UAT/docs/tests/API specs, propose inferred UAT cases when none
exist, surface the proposed contract and gaps to the user, and lock the exact
approved version before it becomes authoritative.

## Tools

- `discover_test_assets` — find existing UAT/docs/tests/API specs.
- `propose_uat` — generate a proposed UAT contract (DRAFT) plus gaps.
- `validate_uat_contract` — structurally validate a contract.
- `freeze_uat_contract` — approve and lock the exact version; record its hash.

## Related requirements

- Requirements 1.1, 3.1–3.6, 4.1–4.6
