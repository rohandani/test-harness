---
name: runtime
description: Detect the technology stack and generate, display, and approve a runtime contract describing how the application is built, started, health-checked, seeded, and tested.
---

# Runtime Skill

Orchestrates runtime adapter detection and the runtime contract approval gate for
the AI Transformation Validator.

> Stub created by task 1.1. Full behavior is authored in task 19.1.

## Purpose

Run adapter detection with confidence and evidence, compose a runtime contract
draft, surface the full display set (including destructive operations and
unsupported assumptions), and approve the exact version before execution.

## Tools

- `detect_runtime` — run adapter detection with confidence + evidence.
- `generate_runtime_contract` — produce a runtime contract draft.
- `validate_runtime_contract` — approve a runtime contract version.

## Related requirements

- Requirements 1.1, 5.1–5.5, 6.1–6.4
