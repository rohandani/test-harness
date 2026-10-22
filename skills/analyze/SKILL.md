---
name: analyze
description: Analyze a repository to detect applications, candidate runtimes, dependencies, interfaces, and existing test assets before validation.
---

# Analyze Skill

Orchestrates project analysis for the AI Transformation Validator.

> Stub created by task 1.1. Full behavior is authored in task 19.1.

## Purpose

Inspect a single-project repository and surface detected applications, candidate
runtimes, required dependencies, candidate commands, externally reachable
interfaces, existing test assets, assumptions, and unsupported components. Every
finding is labeled as a detected `fact` or an `inference`.

## Tools

- `analyze_project` — inspect the repo and emit the analysis.

## Related requirements

- Requirements 1.1, 2.1–2.4
