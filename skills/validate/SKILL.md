---
name: validate
description: Replay the approved contract against the transformed application, verify baseline integrity, and run the three-way differential comparison and classification.
---

# Validate Skill

Orchestrates the transformed replay and the three-way comparison for the AI
Transformation Validator.

> Stub created by task 1.1. Full behavior is authored in task 19.1.

## Purpose

Resume after an independent transformation, provision a clean MicroVM with
equivalent fixtures, replay the baseline's locked UAT version, verify the
baseline manifest hashes, and classify each case via the three-way truth table.

## Tools

- `resume_run`, `prepare_transformed_run`
- `compare_runs`, `get_run_status`

## Related requirements

- Requirements 1.1, 12.x, 13.x, 14.x, 16.x
