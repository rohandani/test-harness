# Requirements Document

## Introduction

The AI Transformation Validator is a Kiro Power that produces credible evidence that an AI-modernized application preserves required behavior. The Validator discovers or generates a behavioral test contract (UAT), requires explicit user approval before that contract becomes authoritative, then executes the approved contract against the legacy application inside a disposable AWS Lambda MicroVM sandbox to freeze immutable baseline evidence. After an independent transformation step, the Validator recreates a clean execution environment, replays the identical approved contract against the transformed application, and produces a transparent differential comparison and confidence matrix.

A central principle governs the design: "same as legacy" does not automatically mean "correct." The Validator performs a three-way comparison between expected behavior, legacy observations, and transformed observations so that pre-existing defects are distinguished from regressions rather than silently blessed as baseline behavior.

This document scopes acceptance criteria to the MVP MUST capabilities (source section 31). SHOULD and Later capabilities are noted as explicitly out of MVP scope where relevant. The primary runtime is TypeScript on Node.js 22 or later, using the MCP SDK and Zod schemas. The execution sandbox is AWS Lambda MicroVMs. All AWS execution and storage occur solely within the customer's AWS account, the control plane runs locally inside the Kiro/MCP process on the developer's machine, and the product operates no AWS infrastructure of its own. The initial transformation integration is AWS Transform for Kiro, treated as an independent transformation provider. UI and browser end-to-end testing are out of scope for this release and may be added in a later release.

## Glossary

- **Validator**: The complete AI Transformation Validator system, exposed as a Kiro Power with a TypeScript MCP server and skills.
- **Kiro_Power**: The Agent Plugin package (plugin.json, mcp.json, skills) through which users interact with the Validator.
- **MCP_Server**: The TypeScript Model Context Protocol server that exposes the Validator's idempotent operations as MCP tools.
- **UAT_Contract**: A versioned artifact defining what should happen — business workflows, API assertions, integration scenarios, expected outcomes, criticality, evidence expectations, and comparison policy.
- **UAT_Case**: A single behavioral test case within a UAT_Contract, carrying id, title, source, confidence, criticality, type, preconditions, steps, expected outcomes, comparison policy, and required evidence.
- **Runtime_Contract**: A versioned artifact defining how a specific version of the application is built, started, health-checked, seeded, and tested.
- **Runtime_Adapter**: A technology-stack-specific component that detects a stack and discovers build, run, health, test, and dependency specifications.
- **Baseline_Evidence**: The immutable observable record of what the approved legacy version actually did under the approved UAT_Contract.
- **Transformed_Evidence**: The observable record of what the transformed version did under the same approved UAT_Contract and equivalent deterministic state.
- **Differential_Result**: The comparison of expected behavior, Baseline_Evidence, and Transformed_Evidence that yields per-case classifications.
- **Confidence_Matrix**: A transparent, weighted report of validation confidence across named dimensions, with visible raw counts and scores.
- **Baseline_Manifest**: The integrity record of a locked baseline, including UAT hash, runtime hash, fixture hash, evidence manifest hash, source git commit, and approval metadata.
- **MicroVM**: An AWS Lambda MicroVM used as a disposable, isolated sandbox for building, running, and testing untrusted customer code.
- **Validation_Run**: A tracked execution of the validation workflow with a persisted, resumable state machine.
- **Control_Plane**: The component responsible for workflow state, approvals, adapter selection, orchestration, manifests, result normalization, comparison, and reporting. The Control_Plane runs locally within the Kiro/MCP process on the developer's machine and is not vendor-hosted.
- **Data_Plane**: The execution plane responsible for source staging, build, dependency installation, application execution, test execution, raw evidence capture, and temporary fixture state.
- **Customer_Account**: The customer-owned AWS account in which all Validator AWS resources (MicroVM execution, evidence storage, secrets, keys, logs) are provisioned and run.
- **Validation_Role**: A customer-provided least-privilege IAM role that the Control_Plane assumes, via temporary STS credentials, to provision and operate resources within the Customer_Account.
- **Transformation_Provider**: An independent modernization step (initially AWS Transform for Kiro) that transforms source code between baseline and transformed validation.
- **Idempotency_Key**: A client-supplied identifier that lets a state-changing operation be retried safely without duplicating effects.

## Requirements

### Requirement 1: Kiro Power and MCP Server Scaffold

**User Story:** As a developer, I want the Validator delivered as a Kiro Power with a TypeScript MCP server, so that I can orchestrate validation from within Kiro.

#### Acceptance Criteria

1. THE Kiro_Power SHALL provide an Agent Plugin structure containing plugin.json, mcp.json, and skills for analyze, uat, runtime, baseline, validate, and report.
2. THE MCP_Server SHALL be implemented in TypeScript targeting Node.js version 22 or later.
3. THE MCP_Server SHALL validate the structure of every tool input and output against a defined schema.
4. THE MCP_Server SHALL expose each workflow capability as a discrete operation rather than a single combined workflow operation.
5. WHERE an operation changes persisted state, THE MCP_Server SHALL accept an Idempotency_Key and SHALL return the original result when the same Idempotency_Key is replayed.

### Requirement 2: Project Analysis

**User Story:** As a developer, I want the Validator to analyze my repository, so that I understand the detected runtimes, dependencies, interfaces, and test assets before validation.

#### Acceptance Criteria

1. WHEN a user requests project analysis for a single-project repository, THE Validator SHALL inspect available build manifests, container definitions, CI/CD configuration, application entrypoints, test configuration, API definitions, routes, environment templates, database schema, documentation, and existing test assets.
2. WHEN project analysis completes, THE Validator SHALL produce detected applications, candidate runtimes, required dependencies, candidate commands, externally reachable interfaces, existing test assets, assumptions, and unsupported components.
3. THE Validator SHALL label each analysis finding as either a detected fact or an inference.
4. IF the repository contains a component the Validator cannot classify, THEN THE Validator SHALL report the component as unsupported rather than assigning an inferred runtime.

### Requirement 3: UAT Discovery and Generation

**User Story:** As a developer, I want the Validator to discover existing tests and propose a UAT plan when none exists, so that I have a behavioral contract to approve.

#### Acceptance Criteria

1. WHEN a user requests UAT discovery, THE Validator SHALL identify existing user-provided UAT, repository documentation, test cases, and API specifications available in the project, and SHALL return each identified asset with a source classification of existing or user.
2. WHERE no existing UAT is found, THE Validator SHALL generate a proposed UAT_Contract whose UAT_Cases are derived from code, tests, API definitions, routes, business-rule code paths, database constraints, configuration, and sample payloads, and SHALL classify each generated UAT_Case with a source of inferred.
3. WHEN the Validator generates a UAT_Case, THE Validator SHALL record the case id, title, a source classification that is exactly one of existing, user, or inferred, source references, a confidence value between 0.0 and 1.0 inclusive, a criticality that is exactly one of critical, high, medium, or low, a type that is exactly one of api, integration, unit, or workflow, preconditions, steps, expected outcomes, comparison policy, and required evidence.
4. WHEN the Validator proposes a UAT_Contract, THE Validator SHALL present the assumptions made and the areas left uncovered as explicit entries in the proposed UAT_Contract.
5. WHERE the project requires parsing or serializing a data format, THE Validator SHALL propose a parse case, a corresponding pretty-print case, and a round-trip case whose expected outcome asserts that parsing an input, printing the parsed result, and parsing that printed output again produces a result equal to the first parsed result under the round-trip case comparison policy.
6. IF UAT discovery finds no existing UAT and generation derives no UAT_Case, THEN THE Validator SHALL return an empty proposed UAT_Contract and SHALL report that no cases could be derived, identifying the uncovered areas rather than producing an unapproved placeholder case.

### Requirement 4: UAT Approval and Locking

**User Story:** As a developer, I want to explicitly approve and lock the UAT contract, so that the behavioral contract is authoritative and cannot change silently between runs.

#### Acceptance Criteria

1. WHEN a UAT_Contract is generated, THE Validator SHALL set the UAT_Contract status to DRAFT.
2. WHILE a UAT_Contract is in DRAFT status, THE Validator SHALL allow the user to add, edit, remove, reprioritize, and reject UAT_Cases.
3. THE Validator SHALL exclude any UAT_Contract from authoritative baseline execution until the user explicitly approves the exact UAT_Contract version.
4. WHEN a user approves a UAT_Contract version, THE Validator SHALL transition the UAT_Contract from DRAFT to APPROVED and then to LOCKED.
5. WHEN a UAT_Contract is LOCKED, THE Validator SHALL record a content hash of the locked UAT_Contract version.
6. WHEN a user approves a new UAT_Contract version after a prior version is LOCKED, THE Validator SHALL create a superseding version and SHALL retain the prior locked version.

### Requirement 5: Runtime Adapter Resolution

**User Story:** As a developer, I want the Validator to resolve my technology stack through adapters, so that build and run logic is stack-specific and overridable.

#### Acceptance Criteria

1. THE Validator SHALL provide Runtime_Adapters for a generic Docker stack, Node.js, Java Maven, and Java Gradle.
2. WHEN a Runtime_Adapter detects a stack, THE Runtime_Adapter SHALL return a detection confidence and the evidence supporting the detection.
3. WHERE a valid Dockerfile is present, THE Validator SHALL offer the generic Docker Runtime_Adapter as the preferred fallback.
4. WHERE multiple Runtime_Adapters detect applicable stacks, THE Validator SHALL allow more than one Runtime_Adapter to contribute to the Runtime_Contract.
5. THE Validator SHALL allow the user to override the selected Runtime_Adapter.

### Requirement 6: Runtime Contract Generation and Approval

**User Story:** As a developer, I want to review and approve a runtime contract before execution, so that the Validator runs my application only in the way I authorize.

#### Acceptance Criteria

1. WHEN a user requests runtime contract generation, THE Validator SHALL produce a Runtime_Contract draft containing build commands, runtime strategy and version, start command, ports, health check, required environment variables, secret references, dependent services, fixture reset and seed commands, readiness conditions, and test commands.
2. WHEN the Validator presents a Runtime_Contract draft, THE Validator SHALL display the detected stack, commands, ports, dependent services, environment variables, secret references, fixture strategy, network dependencies, destructive operations, and unsupported assumptions.
3. THE Validator SHALL exclude any Runtime_Contract from execution until the user explicitly approves the Runtime_Contract.
4. THE Validator SHALL version the Runtime_Contract independently for the legacy application and the transformed application.

### Requirement 7: MicroVM Provisioning and Isolation

**User Story:** As a security-conscious developer, I want each validation job to run in an isolated disposable sandbox, so that untrusted customer code cannot affect other jobs or escape its permissions.

#### Acceptance Criteria

1. THE Validator SHALL execute customer repository code and dependency installation scripts under the MicroVM isolation and least-privilege controls defined in these criteria, and SHALL NOT grant such code any permission beyond its MicroVM's assigned execution role.
2. WHEN the Validator provisions an execution environment for a Validation_Run, THE Validator SHALL provision a dedicated MicroVM used by no other Validation_Run.
3. THE Validator SHALL NOT share mutable filesystem or runtime state between any two MicroVMs.
4. THE Validator SHALL assign each MicroVM a least-privilege IAM execution role and runtime-only temporary credentials, and SHALL NOT provide any control-plane credentials to the MicroVM.
5. THE Validator SHALL apply to each MicroVM a configurable maximum run duration, configurable CPU, memory, and disk limits where supported, and an outbound network policy that denies all egress except explicitly approved destinations.
6. WHEN a MicroVM reaches its configured maximum run duration before its Validation_Run completes, THE Validator SHALL terminate the MicroVM and record a timeout failure for the associated Validation_Run.
7. THE Validator SHALL exclude control-plane credentials and tenant-unique secrets from any reusable MicroVM image or snapshot.
8. WHEN a Validation_Run job completes or fails, THE Validator SHALL terminate the associated MicroVM, release its resources, and record a cleanup result for that MicroVM.
9. IF termination or resource release of a MicroVM does not succeed, THEN THE Validator SHALL record a cleanup failure for that MicroVM and flag it for follow-up so that the MicroVM is not reused by another Validation_Run.

### Requirement 8: Fixtures, Determinism, and Secret Injection

**User Story:** As a developer, I want equivalent deterministic starting state and runtime-injected secrets, so that baseline and transformed runs are comparable and secrets never leak.

#### Acceptance Criteria

1. WHEN a MicroVM is provisioned for a Validation_Run, THE Validator SHALL restore the deterministic fixture state defined by the Runtime_Contract before starting the application.
2. THE Validator SHALL inject secrets into a MicroVM only at run time using the secret references in the Runtime_Contract.
3. THE Validator SHALL exclude secret values from Git, logs, snapshots, UAT artifacts, and reports.
4. WHEN the Validator captures logs, THE Validator SHALL redact values matching known secret formats.
5. THE Validator SHALL prevent a transformed Validation_Run from reusing mutable state produced by the baseline Validation_Run.

### Requirement 9: Build, Start, and Health Check

**User Story:** As a developer, I want the Validator to build, start, and confirm application readiness, so that tests run against a healthy application.

#### Acceptance Criteria

1. WHEN a MicroVM has restored its fixture state, THE Validator SHALL run the Runtime_Contract build commands and then the start command.
2. WHEN the application has started, THE Validator SHALL wait for the Runtime_Contract readiness condition before executing tests.
3. IF the readiness condition is not met within the configured timeout, THEN THE Validator SHALL classify the failure as a health or readiness failure and SHALL NOT execute the test contract.

### Requirement 10: Test Execution and Evidence Capture

**User Story:** As a developer, I want the approved contract executed and its evidence captured, so that I have an auditable record of behavior.

#### Acceptance Criteria

1. WHEN the application is ready, THE Validator SHALL execute the unit, API, and integration test commands defined in the approved contract.
2. WHEN test execution completes, THE Validator SHALL capture evidence including normalized test results, request and response pairs, and application logs.
3. THE Validator SHALL stream or upload large evidence to artifact storage rather than returning large evidence within an MCP tool response payload.

### Requirement 11: Baseline Evidence Integrity

**User Story:** As a developer, I want baseline evidence frozen with verifiable integrity, so that a later comparison is trustworthy.

#### Acceptance Criteria

1. WHEN baseline execution completes, THE Validator SHALL produce a Baseline_Manifest containing the baseline id, the UAT version, the source git commit, the UAT hash, the runtime hash, the fixture hash, the evidence manifest hash, the approver, the approval time, and a status of LOCKED.
2. THE Validator SHALL record the Baseline_Evidence as immutable once the Baseline_Manifest status is LOCKED.
3. THE Validator SHALL NOT convert a pre-existing legacy failure into an expected outcome rule automatically.
4. WHEN a user requests a transformed comparison, THE Validator SHALL verify the Baseline_Manifest hashes before performing the comparison.
5. IF a Baseline_Manifest hash verification fails, THEN THE Validator SHALL stop the comparison and SHALL report the integrity failure.

### Requirement 12: Independent Transformation Boundary

**User Story:** As a developer, I want transformation to happen independently of validation, so that the Validator remains a neutral evidence provider.

#### Acceptance Criteria

1. WHEN baseline evidence is locked, THE Validator SHALL pause and await an independent transformation performed by a Transformation_Provider.
2. THE Validator SHALL treat AWS Transform for Kiro as an independent Transformation_Provider and SHALL NOT own its internals.
3. WHEN the user signals that transformation is complete, THE Validator SHALL resume the Validation_Run and analyze the transformed runtime.
4. THE Validator SHALL define the transformation integration through a generic transformation boundary that admits additional providers.

### Requirement 13: Transformed Replay Under the Same Contract

**User Story:** As a developer, I want the transformed application validated against the identical approved contract, so that the comparison is fair.

#### Acceptance Criteria

1. WHEN a transformed Validation_Run begins, THE Validator SHALL provision a new clean MicroVM separate from the baseline MicroVM.
2. WHEN the transformed MicroVM is provisioned, THE Validator SHALL restore fixture state equivalent to the baseline fixture state.
3. THE Validator SHALL execute the transformed run against the locked UAT_Contract version associated with the baseline.
4. WHEN transformed execution completes, THE Validator SHALL capture Transformed_Evidence using the same evidence expectations applied during the baseline run.

### Requirement 14: Differential Comparison and Classification

**User Story:** As a developer, I want a three-way comparison that distinguishes defects from regressions, so that "same as legacy" is never mistaken for "correct."

#### Acceptance Criteria

1. WHEN comparing a UAT_Case, THE Validator SHALL evaluate the expected outcome, the Baseline_Evidence observation, and the Transformed_Evidence observation, where each observation resolves to exactly one of pass, fail, blocked, or not_executed.
2. THE Validator SHALL classify each compared UAT_Case as exactly one of UNCHANGED_PASS, REGRESSION, EXISTING_DEFECT, IMPROVEMENT, BLOCKED, NOT_EXECUTED, INTENTIONAL_CHANGE, or INCONCLUSIVE, assigning no more than one classification per UAT_Case.
3. WHEN the expected outcome is pass, the baseline observation is pass, and the transformed observation is fail, THE Validator SHALL classify the UAT_Case as REGRESSION.
4. WHEN the expected outcome is pass, the baseline observation is fail, and the transformed observation is fail, THE Validator SHALL classify the UAT_Case as EXISTING_DEFECT.
5. WHEN the expected outcome is pass, the baseline observation is fail, and the transformed observation is pass, THE Validator SHALL classify the UAT_Case as IMPROVEMENT.
6. WHEN the expected outcome is pass, the baseline observation is pass, and the transformed observation is pass, THE Validator SHALL classify the UAT_Case as UNCHANGED_PASS.
7. WHEN either the baseline observation or the transformed observation is blocked, THE Validator SHALL classify the UAT_Case as BLOCKED, and WHEN neither observation is blocked and either observation is not_executed, THE Validator SHALL classify the UAT_Case as NOT_EXECUTED.
8. WHERE the UAT_Case belongs to a UAT version explicitly approved as a superseding version with a changed expected outcome, WHEN the transformed observation matches the newly approved expected outcome and differs from the baseline observation, THE Validator SHALL classify the UAT_Case as INTENTIONAL_CHANGE.
9. THE Validator SHALL apply per-case comparison strategies including exact, schema, subset, ignored fields, regex, numeric tolerance, date and time tolerance, unordered collection, custom predicate, and semantic comparison as configured in the comparison policy, and SHALL apply the exact comparison strategy to any field for which the comparison policy specifies no strategy.
10. IF a UAT_Case produces differing pass or fail observations across a minimum of 3 consecutive executions of the same approved UAT version in equivalent deterministic state, THEN THE Validator SHALL classify the UAT_Case as INCONCLUSIVE rather than passing, and SHALL NOT assign UNCHANGED_PASS, REGRESSION, EXISTING_DEFECT, or IMPROVEMENT.

### Requirement 15: Confidence Matrix and Reporting

**User Story:** As a developer, I want a transparent weighted confidence report, so that I can trust the result without a black-box score.

#### Acceptance Criteria

1. WHEN comparison completes, THE Validator SHALL produce a Confidence_Matrix containing exactly the six named dimensions Critical Workflows, Approved UAT Execution, API/Contract Compatibility, Integration Behavior, Environment Parity/Determinism, and Evidence Completeness, each with a configured weight defaulting to 35%, 20%, 15%, 15%, 10%, and 5% respectively.
2. IF the configured dimension weights do not sum to 100% (±0.1%), THEN THE Validator SHALL reject the configuration and produce an error indicating which weights are invalid, without producing a Confidence_Matrix.
3. WHEN comparison completes, THE Validator SHALL display, for each Confidence_Matrix dimension, the raw weighted passed-assertion count, the raw weighted executed-assertion count, and the computed dimensionScore equal to weighted passed assertions divided by weighted executed assertions.
4. WHEN comparison completes, THE Validator SHALL compute overallConfidence as the sum over all dimensions of (dimensionScore × configured weight) and display both the per-dimension values and the overallConfidence value.
5. IF any UAT_Case with criticality "critical" is classified as REGRESSION, THEN THE Validator SHALL set the overall gate to FAIL regardless of the computed overallConfidence value.
6. IF any UAT_Case with criticality "critical" is classified as NOT_EXECUTED, THEN THE Validator SHALL set the overall gate to no higher than INCONCLUSIVE regardless of the computed overallConfidence value.
7. THE Validator SHALL count only UAT_Cases classified as REGRESSION toward the new-regression total and SHALL exclude every UAT_Case classified as EXISTING_DEFECT, IMPROVEMENT, UNCHANGED_PASS, BLOCKED, NOT_EXECUTED, INTENTIONAL_CHANGE, or INCONCLUSIVE from that total.
8. THE Validator SHALL exclude intentionally unsupported areas from the overallConfidence denominator only WHERE that exclusion has been explicitly accepted, and SHALL list every excluded area in the report.
9. WHEN reporting completes, THE Validator SHALL produce one Markdown report and one JSON report that each contain identical per-UAT_Case classifications, evidence references for each case, the coverage breakdown (approved-UAT execution, critical-workflow, API contract, integration, and blocked/unsupported coverage), the Confidence_Matrix, the overallConfidence value, and the overall gate result.

### Requirement 16: Validation Run State and Resumability

**User Story:** As a developer, I want validation runs to be stateful and resumable, so that long workflows survive interruptions and remain auditable.

#### Acceptance Criteria

1. THE Validator SHALL persist the state of each Validation_Run through the defined workflow states from creation through completion, failure, or cancellation.
2. WHEN a Validation_Run transitions between states, THE Validator SHALL persist the new state.
3. WHEN a user requests the status of a Validation_Run, THE Validator SHALL return the current persisted state.
4. THE Validator SHALL record an audit trail of approvals and executions for each Validation_Run.

### Requirement 17: Control Plane and Data Plane Separation

**User Story:** As a security-conscious developer, I want orchestration separated from execution and all execution kept within my own AWS account, so that only required evidence crosses the boundary and the product runs no infrastructure of its own.

#### Acceptance Criteria

1. THE Control_Plane SHALL own workflow state, approvals, adapter selection, orchestration, manifests, result normalization, comparison, and reporting.
2. THE Data_Plane SHALL own source staging, build, dependency installation, application execution, test execution, raw evidence capture, and temporary fixture state.
3. THE Control_Plane SHALL receive only the evidence required to compute and report results.
4. THE Validator SHALL use separate identities for the Control_Plane and the Data_Plane.
5. THE Control_Plane SHALL run locally within the Kiro MCP server process and SHALL NOT require any vendor-operated AWS infrastructure.
6. THE Validator SHALL provision and run all AWS resources, including the MicroVM, evidence and artifact storage, secret retrieval, encryption keys, and logs, exclusively within the Customer_Account.
7. WHEN the Control_Plane needs to operate resources in the Customer_Account, THE Control_Plane SHALL assume the customer-provided Validation_Role and SHALL use the resulting temporary credentials.
8. THE Validator SHALL NOT store customer source code, evidence, or secrets outside the Customer_Account.

### Requirement 18: Failure Categorization

**User Story:** As a developer, I want failures categorized by cause, so that infrastructure problems are never reported as application regressions.

#### Acceptance Criteria

1. WHEN a Validation_Run fails, THE Validator SHALL categorize the failure as one of configuration, unsupported stack, build, dependency, fixture, health or readiness, test failure, runner failure, infrastructure, timeout, permission, artifact or evidence, comparison, or cleanup.
2. THE Validator SHALL NOT report an infrastructure failure or a test-runner failure as an application regression.
3. WHERE an operation is a retry-safe infrastructure operation, THE Validator SHALL allow retries of that operation.
