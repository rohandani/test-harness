# Implementation Plan: AI Transformation Validator

## Overview

This plan builds the AI Transformation Validator as a Kiro Power backed by a TypeScript MCP server (Node.js 22+). It follows the recommended build sequence: contract schemas first, then adapter interface with Docker/Node proof, a local runner proof before the cloud runner, the Lambda MicroVM runner, baseline evidence, the comparison engine, the Kiro Power approval UX, Java adapters, deterministic DB fixtures, the confidence matrix, security/customer-account hardening, and finally broader stacks and dependency policies.

Pure-logic components with correctness properties (classification, confidence matrix, baseline integrity, idempotency, secret redaction, UAT locking, round-trip) are built and property-tested early. AWS-dependent surfaces (MicroVM, STS, S3, Secrets Manager) are built behind interfaces and mocked for unit/property tests; a late integration task wires real AWS. UI/browser/Playwright testing is out of scope and is not included.

Property-based tests use fast-check (minimum 100 iterations) and are tagged `Feature: ai-transformation-validator, Property {n}: {text}`.

## Tasks

- [x] 1. Scaffold Kiro Power package and TypeScript MCP server bootstrap
  - [x] 1.1 Create the Kiro Power package structure
    - Create `transformation-validator/plugin.json`, `transformation-validator/mcp.json`, and the six skill stubs `skills/{analyze,uat,runtime,baseline,validate,report}/SKILL.md`
    - Initialize the Node.js 22+ TypeScript project (`tsconfig.json`, `package.json` with MCP SDK, Zod, fast-check, vitest/jest), set up the test runner and lint config
    - _Requirements: 1.1, 1.2_

  - [x] 1.2 Implement the MCP tool router with Zod I/O validation and the idempotency layer
    - Register each workflow capability as a discrete MCP tool; validate every tool input and output against a Zod schema and reject malformed I/O
    - Implement an `idempotencyKey` store that records the first result per key and returns the stored result on replay without re-running side effects
    - _Requirements: 1.3, 1.4, 1.5_

  - [x] 1.3 Write property test for idempotency of state-changing operations
    - **Property 1: Idempotency of state-changing operations** — replaying a key returns the original result and produces no duplicate side effect
    - **Validates: Requirements 1.5**
    - _Requirements: 1.5_ _Property: 1_

  - [x] 1.4 Write unit tests for Zod schema rejection of malformed tool I/O
    - Assert well-formed payloads pass and malformed payloads are rejected with schema errors
    - _Requirements: 1.3_

- [x] 2. Define Zod-backed contract schemas and shared types
  - [x] 2.1 Implement core domain schemas and types
    - Define Zod schemas and TypeScript types for `UatContract`, `UatCase`, `UatStep`, `ExpectedOutcome`, `ComparisonPolicy`, `RuntimeContract`, `HealthSpec`, `SecretRef`, `BaselineManifest`, `EvidenceArtifactRef`, `NormalizedCaseResult`, `DifferentialCaseResult`, `ConfidenceDimension`, `ConfidenceMatrix`, and the `Observation`/`Classification`/`ComparisonStrategy` enums
    - Enforce enumerated constraints (source, criticality, type, status) and the 0.0–1.0 confidence bound at the schema level
    - _Requirements: 1.3, 3.3, 14.1, 14.2, 15.1_

  - [x] 2.2 Write property test for generated UAT_Case structural validity
    - **Property 3: Generated UAT_Case structural validity** — required fields present; source/criticality/type in their enums; confidence in [0.0, 1.0]
    - **Validates: Requirements 3.3**
    - _Requirements: 3.3_ _Property: 3_

- [x] 3. Implement the baseline integrity / manifest hasher (pure logic)
  - [x] 3.1 Implement content hashing and Baseline_Manifest build + verification
    - Compute canonical sha256 content hashes for UAT, runtime, fixture, and evidence manifests; assemble a `BaselineManifest` with all required fields and status `LOCKED`
    - Implement verification that recomputes every hash and gates comparison: proceed only if all hashes match, otherwise stop and report an integrity failure
    - Ensure baseline evidence is immutable once LOCKED and that a pre-existing legacy failure is never converted into an expected-outcome rule
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 3.2 Write property test for baseline manifest completeness and integrity gating
    - **Property 14: Baseline manifest completeness and integrity gating** — manifest complete + LOCKED; comparison proceeds iff every recorded hash matches, otherwise integrity failure
    - **Validates: Requirements 11.1, 11.4, 11.5**
    - _Requirements: 11.1, 11.4, 11.5_ _Property: 14_

  - [x] 3.3 Write property test for expected outcomes independent of baseline evidence
    - **Property 15: Expected outcomes are independent of baseline evidence** — a case's expected outcome is identical before and after baseline capture; a legacy failure is never promoted
    - **Validates: Requirements 11.3**
    - _Requirements: 11.3_ _Property: 15_

- [ ] 4. Implement the UAT Engine (discovery, generation, versioning/locking)
  - [ ] 4.1 Implement UAT discovery and generation
    - `discover_test_assets`: identify existing UAT/docs/tests/API specs, tagging each `existing` or `user`
    - `propose_uat`: derive inferred UAT_Cases from code/tests/API/routes/business rules/DB constraints/config/sample payloads; record assumptions and uncovered areas; for a parsed/serialized format propose parse, pretty-print, and round-trip cases; return an empty contract reporting uncovered areas when nothing can be derived
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ] 4.2 Implement UAT versioning, approval, and locking
    - `validate_uat_contract` (structural); `freeze_uat_contract` driving `DRAFT → APPROVED → LOCKED`, recording the content hash; refuse authoritative execution unless LOCKED; create superseding versions while retaining prior locked versions with their original hashes
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 4.3 Write property test for parse/print round-trip
    - **Property 4: Parse/print round-trip** — `parse(print(parse(x))) == parse(x)` under the round-trip comparison policy
    - **Validates: Requirements 3.5**
    - _Requirements: 3.5_ _Property: 4_

  - [ ]* 4.4 Write property test for authoritative execution requiring a LOCKED contract
    - **Property 5: Authoritative execution requires a LOCKED contract** — non-LOCKED contracts are refused for baseline execution
    - **Validates: Requirements 4.3**
    - _Requirements: 4.3_ _Property: 5_

  - [ ]* 4.5 Write property test for UAT lock immutability and version lineage
    - **Property 6: UAT lock immutability and version lineage** — locked content hash is stable; prior version retrievable with original hash; new version records supersession
    - **Validates: Requirements 4.5, 4.6**
    - _Requirements: 4.5, 4.6_ _Property: 6_

  - [ ]* 4.6 Write unit test for the empty-contract no-placeholder case
    - Assert `propose_uat` returns an empty contract and reports uncovered areas instead of an unapproved placeholder case
    - _Requirements: 3.6_

- [ ] 5. Implement the Analyzer
  - [ ] 5.1 Implement single-project analysis and fact/inference labeling
    - Inspect build manifests, container definitions, CI/CD config, entrypoints, test config, API definitions, routes, env templates, DB schema, docs, and existing test assets; emit detected applications, candidate runtimes, dependencies, commands, interfaces, test assets, assumptions, and unsupported components
    - Label every finding `fact` or `inference`; report unclassifiable components as `unsupported` with no inferred runtime
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 5.2 Write property test for totally labeled analysis findings
    - **Property 2: Analysis findings are totally labeled** — every finding is exactly `fact` or `inference`; unclassifiable components appear as unsupported with no inferred runtime
    - **Validates: Requirements 2.3, 2.4**
    - _Requirements: 2.3, 2.4_ _Property: 2_

- [ ] 6. Implement the Comparison + Classification Engine (pure logic)
  - [ ] 6.1 Implement the three-way classifier and truth table
    - Resolve each of expected/baseline/transformed to one of `pass|fail|blocked|not_executed`; assign exactly one of the eight classifications per the truth table with precedence (BLOCKED over NOT_EXECUTED; INCONCLUSIVE over the four stable classes); handle INTENTIONAL_CHANGE for superseding versions
    - Detect flakiness: ≥3 disagreeing executions of the same approved UAT version in equivalent deterministic state → INCONCLUSIVE
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.10_

  - [ ] 6.2 Implement the comparison strategy dispatcher
    - Implement exact, schema, subset, ignoredFields, regex, numericTolerance, dateTimeTolerance, unordered, customPredicate, and semantic strategies (semantic enabled only for explicitly approved cases); default ungoverned fields to exact
    - _Requirements: 14.9_

  - [ ]* 6.3 Write property test for classification totality, exclusivity, and truth-table correctness
    - **Property 17: Classification totality, exclusivity, and truth-table correctness** — exactly one of eight classifications, matching an independent reference truth table with precedence rules
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8**
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_ _Property: 17_

  - [ ]* 6.4 Write property test for comparison defaulting to exact for ungoverned fields
    - **Property 18: Comparison defaults to exact for ungoverned fields**
    - **Validates: Requirements 14.9**
    - _Requirements: 14.9_ _Property: 18_

  - [ ]* 6.5 Write property test for flaky cases classified INCONCLUSIVE
    - **Property 19: Flaky cases are INCONCLUSIVE** — ≥3 disagreeing executions → INCONCLUSIVE and never UNCHANGED_PASS/REGRESSION/EXISTING_DEFECT/IMPROVEMENT
    - **Validates: Requirements 14.10**
    - _Requirements: 14.10_ _Property: 19_

- [ ] 7. Checkpoint - core pure-logic engines
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement the Confidence Matrix Engine and Report Generator
  - [ ] 8.1 Implement the confidence matrix with weight validation and gate logic
    - Produce exactly the six named dimensions with default weights 35/20/15/15/10/5; reject weight vectors not summing to 100% (±0.1%) with an error naming invalid weights and no matrix; compute `dimensionScore = weightedPassed / weightedExecuted` and `overallConfidence = Σ(dimensionScore × weight)`
    - Apply gate overrides: critical REGRESSION → FAIL; critical NOT_EXECUTED → cap at INCONCLUSIVE; `newRegressionCount` counts only REGRESSION; exclude only explicitly accepted unsupported areas from the denominator and list every excluded area
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8_

  - [ ] 8.2 Implement the Markdown and JSON report generators
    - Emit one Markdown and one JSON report, each with identical per-case classifications, per-case evidence references, coverage breakdown, confidence matrix, overallConfidence, and gate result
    - _Requirements: 15.9_

  - [ ]* 8.3 Write property test for dimension set and weight validation
    - **Property 20: Confidence matrix dimension set and weight validation** — exactly six named dimensions; matrix produced iff weights sum to 100% (±0.1%), else error naming invalid weights
    - **Validates: Requirements 15.1, 15.2**
    - _Requirements: 15.1, 15.2_ _Property: 20_

  - [ ]* 8.4 Write property test for score determinism and formula
    - **Property 21: Confidence score determinism and formula** — dimensionScore and overallConfidence match independent recomputation; identical inputs yield identical results
    - **Validates: Requirements 15.3, 15.4**
    - _Requirements: 15.3, 15.4_ _Property: 21_

  - [ ]* 8.5 Write property test for gate overrides and regression accounting
    - **Property 22: Gate overrides and regression accounting** — critical REGRESSION forces FAIL; critical NOT_EXECUTED caps at INCONCLUSIVE; newRegressionCount equals REGRESSION count only
    - **Validates: Requirements 15.5, 15.6, 15.7**
    - _Requirements: 15.5, 15.6, 15.7_ _Property: 22_

  - [ ]* 8.6 Write property test for explicit, listed denominator exclusions
    - **Property 23: Denominator exclusions are explicit and listed**
    - **Validates: Requirements 15.8**
    - _Requirements: 15.8_ _Property: 23_

  - [ ]* 8.7 Write property test for Markdown/JSON report consistency
    - **Property 24: Markdown and JSON reports are consistent** — identical per-case classifications and all required sections in both reports
    - **Validates: Requirements 15.9**
    - _Requirements: 15.9_ _Property: 24_

- [ ] 9. Implement the Runtime Adapter pattern with Docker and Node.js adapters
  - [ ] 9.1 Implement the RuntimeAdapter interface and AdapterRegistry
    - Define `RuntimeAdapter` (detect/discoverBuild/run/health/tests/dependencies/generate/validate) and `DetectionResult`; implement a registry that ranks applicable adapters by confidence, prefers Docker fallback where a valid Dockerfile exists, allows multiple adapters to contribute, and allows user override
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ] 9.2 Implement the generic Docker and Node.js adapters
    - Detection with confidence + evidence and spec discovery for Docker and Node.js stacks
    - _Requirements: 5.1, 5.2_

  - [ ]* 9.3 Write adapter conformance suite and property test for bounded detection confidence
    - Shared conformance suite asserting the interface contract across adapters
    - **Property 7: Adapter detection reports bounded confidence and evidence** — confidence in [0.0, 1.0]; evidence present when applicable
    - **Validates: Requirements 5.2**
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_ _Property: 7_

- [ ] 10. Implement the Runtime Contract Engine
  - [ ] 10.1 Implement runtime contract generation, display, approval, and dual versioning
    - `generate_runtime_contract` composing adapter output into a draft (build, runtime strategy+version, start, ports, health, env, secret refs, dependent services, fixtures, readiness, tests); surface the full display set including destructive operations and unsupported assumptions; `validate_runtime_contract` approval; exclude unapproved contracts from execution; version independently for legacy and transformed
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 11. Implement the Run State Machine, metadata persistence, and Failure Categorizer
  - [ ] 11.1 Implement the Validation_Run state machine and audit trail
    - Implement `create_validation_run`, `get_run_status`, `resume_run`; persist every transition through the defined lifecycle; record an append-only audit trail of approvals and executions; back with the metadata store (local JSON for POC behind a repository interface)
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [ ] 11.2 Implement the Failure Categorizer
    - Map any run failure to exactly one of the fourteen categories; never report infrastructure or test-runner failures as application regressions; allow retries only for retry-safe infrastructure operations
    - _Requirements: 18.1, 18.2, 18.3_

  - [ ]* 11.3 Write property test for run state persistence round-trip
    - **Property 25: Run state persistence round-trip** — persisted state equals applied target after each transition; reload yields the same current state
    - **Validates: Requirements 16.1, 16.2, 16.3**
    - _Requirements: 16.1, 16.2, 16.3_ _Property: 25_

  - [ ]* 11.4 Write property test for failure categorization totality and plane separation
    - **Property 26: Failure categorization totality and plane separation** — exactly one of fourteen categories; infrastructure/test-runner failures never surfaced as REGRESSION
    - **Validates: Requirements 18.1, 18.2**
    - _Requirements: 18.1, 18.2_ _Property: 26_

- [ ] 12. Implement the Fixture / Determinism / Secret-injection manager
  - [ ] 12.1 Implement fixture restoration, determinism controls, and secret handling
    - Restore deterministic fixture state before start; apply fixed random seed and clock override; inject secrets only at runtime via secret references; prevent a transformed run from reusing baseline mutable state
    - Implement secret exclusion across Git/logs/snapshots/UAT artifacts/reports and log redaction of known secret formats
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 12.2 Write property test for secret non-leakage across artifacts
    - **Property 9: Secret non-leakage across artifacts** — a secret value never appears in any emitted artifact after redaction/serialization
    - **Validates: Requirements 8.3**
    - _Requirements: 8.3_ _Property: 9_

  - [ ]* 12.3 Write property test for log redaction of secret-format values
    - **Property 10: Log redaction of secret-format values** — every value matching a known secret format is redacted in captured logs
    - **Validates: Requirements 8.4**
    - _Requirements: 8.4_ _Property: 10_

  - [ ]* 12.4 Write property test for transformed run state independence
    - **Property 11: Transformed run state independence** — transformed run starts from the deterministic seed state, unaffected by baseline mutable state
    - **Validates: Requirements 8.5**
    - _Requirements: 8.5_ _Property: 11_

- [ ] 13. Implement the local runner proof (build/start/health, test execution, evidence) behind a Runner interface
  - [ ] 13.1 Implement build/start/health orchestration
    - Define a `Runner` interface; implement a local runner that runs build then start commands, waits for the readiness condition before tests, and classifies a readiness timeout as a health/readiness failure without executing the contract
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ] 13.2 Implement test execution and evidence capture with by-reference evidence
    - Execute unit/API/integration commands from the approved contract; capture normalized (JUnit-compatible) test results, request/response pairs, and logs; stream/upload large evidence to artifact storage and return only references in MCP responses; validate API assertions against OpenAPI/schema
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 13.3 Write property test for readiness failure suppressing test execution
    - **Property 12: Readiness failure suppresses test execution** — readiness timeout → health/readiness failure and zero cases executed
    - **Validates: Requirements 9.3**
    - _Requirements: 9.3_ _Property: 12_

  - [ ]* 13.4 Write property test for evidence returned by reference, not inline
    - **Property 13: Evidence is returned by reference, not inline** — responses contain only evidence references regardless of size
    - **Validates: Requirements 10.3**
    - _Requirements: 10.3_ _Property: 13_

- [ ] 14. Checkpoint - engines, runtime contracts, and local runner integrated
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Implement the Lambda MicroVM runner and AWS clients (mocked for tests)
  - [ ] 15.1 Implement AWS client wrappers behind interfaces
    - Wrap STS (assume `Validation_Role`), Lambda MicroVM provisioning, S3 (signed short-lived upload URLs), Secrets Manager/SSM, KMS, and CloudWatch behind injectable interfaces so unit/property tests use mocks
    - _Requirements: 17.6, 17.7_

  - [ ] 15.2 Implement MicroVM provisioning, isolation, limits, and cleanup
    - `provision_microvm` provisioning a dedicated per-run MicroVM via the assumed role with a least-privilege execution role and runtime-only credentials, no shared mutable state, max duration + CPU/memory/disk limits, and deny-all egress except approved destinations; on duration breach terminate and record a timeout failure; exclude control-plane credentials/tenant secrets from reusable images; `destroy_environment` terminating and recording cleanup, flagging cleanup-failed MicroVMs against reuse
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [ ]* 15.3 Write property test for failed-cleanup MicroVMs never reused
    - **Property 8: Failed-cleanup MicroVMs are never reused** — a cleanup-failed MicroVM is flagged and never appears in the reuse pool
    - **Validates: Requirements 7.9**
    - _Requirements: 7.9_ _Property: 8_

- [ ] 16. Implement the baseline finalization and transformed replay flow
  - [ ] 16.1 Implement baseline finalization
    - `finalize_baseline`: produce and lock the `Baseline_Manifest` from captured evidence; anchor baseline integrity; mark evidence immutable
    - _Requirements: 11.1, 11.2_

  - [ ] 16.2 Implement the transformation boundary and transformed replay
    - `TransformationProvider` interface with AWS Transform treated as an independent provider; pause after baseline lock, resume on completion signal, analyze transformed runtime; `prepare_transformed_run` provisioning a new clean MicroVM with equivalent fixtures, executing the baseline's locked UAT version and the same evidence expectations
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 13.1, 13.2, 13.3, 13.4_

  - [ ]* 16.3 Write property test for transformed replay using the baseline's locked contract and equivalent fixtures
    - **Property 16: Transformed replay uses the baseline's locked contract and equivalent fixtures**
    - **Validates: Requirements 13.2, 13.3**
    - _Requirements: 13.2, 13.3_ _Property: 16_

- [ ] 17. Wire the compare → confidence → report flow through MCP tools
  - [ ] 17.1 Implement compare_runs, generate_confidence_matrix, and report tools
    - `compare_runs` verifies manifest hashes then runs the three-way classifier over every UAT_Case; `generate_confidence_matrix` and the report tool produce the matrix, gate, and Markdown/JSON reports; wire all tools into the run state machine and audit trail
    - _Requirements: 11.4, 14.1, 15.1, 15.9, 16.2_

- [ ] 18. Implement Java Maven and Java Gradle adapters
  - [ ] 18.1 Implement the Maven and Gradle adapters
    - Detection with confidence + evidence and spec discovery; pass the shared adapter conformance suite
    - _Requirements: 5.1, 5.2_

  - [ ]* 18.2 Extend the adapter conformance suite to Maven and Gradle
    - Run the Property 7 conformance checks against both Java adapters
    - **Property 7: Adapter detection reports bounded confidence and evidence**
    - _Requirements: 5.1, 5.2_ _Property: 7_

- [ ] 19. Implement the Kiro Power skills and approval UX wiring
  - [ ] 19.1 Author the six skills to drive the discrete MCP tools
    - Fill in `analyze`, `uat`, `runtime`, `baseline`, `validate`, and `report` SKILL.md to orchestrate their tools and surface approval gates (UAT freeze, runtime approval) and drafts to the user
    - _Requirements: 1.1, 4.2, 4.3, 6.2, 6.3_

- [ ] 20. Implement AWS integration wiring for the customer-account execution model
  - [ ] 20.1 Wire real AWS clients and verify plane separation
    - Connect the mocked AWS interfaces to real STS/Lambda/S3/Secrets Manager/KMS/CloudWatch running in the Customer_Account via the assumed Validation_Role; keep the control plane local in the MCP process; ensure only normalized evidence crosses the Data Plane → Control Plane boundary and separate identities are used; keep customer code/evidence/secrets within the Customer_Account
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8_

  - [ ]* 20.2 Write integration test for MicroVM uniqueness, least-privilege bounds, and boundary payload
    - Assert per-run MicroVM uniqueness and least-privilege role bounds; assert the control-plane payload contains only normalized evidence
    - _Requirements: 7.1, 7.2, 17.3_

- [ ] 21. End-to-end integration test driving a sample application
  - [ ]* 21.1 Drive a sample app through the full flow with simulated transformation
    - analyze → propose/approve UAT → approve runtime → provision MicroVM → baseline execute → finalize baseline → (simulated transformation) → transformed replay → compare → confidence matrix → report, asserting classifications, gate, and report consistency; AWS surfaces stubbed
    - _Requirements: 2.1, 4.4, 6.3, 7.2, 10.1, 11.1, 12.3, 13.3, 14.2, 15.9, 16.1_

- [ ] 22. Final checkpoint - full workflow
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 23. Optional SHOULD/Later extensions
  - [ ]* 23.1 Implement Python and .NET runtime adapters
    - Register as additional `RuntimeAdapter` implementations passing the conformance suite; no orchestrator change
    - _Requirements: 5.1, 5.2_ _Property: 7_

  - [ ]* 23.2 Implement record/replay and sandbox dependency policies
    - Extend `DependencyPolicy` with record/replay and sandbox virtualization modes defaulting to deny/approved destinations
    - _Requirements: 7.5, 8.2_

  - [ ]* 23.3 Enable semantic comparison for explicitly approved cases
    - Register the semantic `ComparisonStrategy`, used only where a case explicitly approves it
    - _Requirements: 14.9_

## Notes

- Tasks marked with `*` are optional (test sub-tasks and SHOULD/Later extensions) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirements for traceability, and each test task referencing a correctness property names its property number.
- AWS-dependent surfaces are built behind interfaces and mocked for unit/property tests (tasks 1–18); real AWS is wired in task 20.
- Checkpoints (tasks 7, 14, 22) ensure incremental validation.
- Property-based tests use fast-check at a minimum of 100 iterations and are tagged `Feature: ai-transformation-validator, Property {n}: {text}`.
- All MVP requirements 1–18 and all correctness properties 1–26 are each covered by at least one task.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.1"] },
    { "id": 3, "tasks": ["2.2", "3.1", "4.1", "5.1", "6.1", "6.2", "9.1"] },
    { "id": 4, "tasks": ["3.2", "3.3", "4.2", "4.3", "4.6", "5.2", "6.3", "6.4", "6.5", "8.1", "9.2", "11.1", "11.2", "12.1"] },
    { "id": 5, "tasks": ["4.4", "4.5", "8.2", "8.3", "9.3", "10.1", "11.3", "11.4", "12.2", "12.3", "12.4", "13.1", "15.1"] },
    { "id": 6, "tasks": ["8.4", "8.5", "8.6", "8.7", "13.2", "15.2", "18.1"] },
    { "id": 7, "tasks": ["13.3", "13.4", "15.3", "16.1", "18.2"] },
    { "id": 8, "tasks": ["16.2", "19.1"] },
    { "id": 9, "tasks": ["16.3", "17.1"] },
    { "id": 10, "tasks": ["20.1"] },
    { "id": 11, "tasks": ["20.2", "21.1"] },
    { "id": 12, "tasks": ["23.1", "23.2", "23.3"] }
  ]
}
```
