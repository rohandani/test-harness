---
name: report
description: Produce the weighted confidence matrix, gate result, and consistent Markdown and JSON validation reports.
---

# Report Skill

Orchestrates confidence scoring and report generation for the AI Transformation
Validator.

> Stub created by task 1.1. Full behavior is authored in task 19.1.

## Purpose

Compute the six-dimension weighted confidence matrix and overall gate, then emit
one Markdown and one JSON report with identical per-case classifications,
evidence references, coverage breakdown, and gate result.

## Tools

- `generate_confidence_matrix` — weighted matrix + gate.
- report generation tool — Markdown + JSON output.

## Related requirements

- Requirements 1.1, 15.1–15.9
