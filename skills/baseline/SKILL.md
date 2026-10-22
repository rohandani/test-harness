---
name: baseline
description: Provision an isolated MicroVM, execute the approved contract against the legacy application, capture evidence, and lock an immutable baseline manifest.
---

# Baseline Skill

Orchestrates baseline execution and finalization for the AI Transformation
Validator.

> Stub created by task 1.1. Full behavior is authored in task 19.1.

## Purpose

Provision a dedicated per-run MicroVM, restore deterministic fixtures, build and
start the application, execute the approved UAT contract, capture normalized
evidence, and lock the baseline manifest with content hashes.

## Tools

- `create_validation_run`, `provision_microvm`, `prepare_fixture`
- `execute_validation`, `collect_evidence`, `finalize_baseline`
- `destroy_environment`

## Related requirements

- Requirements 1.1, 7.x, 8.x, 9.x, 10.x, 11.1, 11.2
