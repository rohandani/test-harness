/**
 * Core domain schemas and shared types for the AI Transformation Validator
 * (Requirements 1.3, 3.3, 14.1, 14.2, 15.1).
 *
 * This module is the single source of truth for the contract shapes exchanged
 * across the system: UAT contracts, runtime contracts, baseline manifests,
 * evidence references, normalized/differential case results, and the confidence
 * matrix. Every shape is defined as a Zod schema and the corresponding
 * TypeScript type is inferred from it (`z.infer`), so the compile-time type and
 * the runtime validator can never drift apart.
 *
 * Enumerated domains (`source`, `criticality`, `type`, `status`, observations,
 * classifications, comparison strategies) are enforced with `z.enum`/`z.literal`
 * so malformed values are rejected at the schema boundary. The UAT confidence
 * value is bounded to the inclusive `[0.0, 1.0]` range at the schema level
 * (Requirement 3.3).
 *
 * The schemas mirror the design document's "Components and Interfaces" / "Data
 * Models" sections. Where the design leaves a supporting type's shape
 * unspecified, a minimal, reasonable shape is used so the governed schemas
 * compile and can be validated; later tasks may enrich these without changing
 * the enumerated/bounded guarantees established here.
 */
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Enumerated domains                                                         */
/* -------------------------------------------------------------------------- */

/** Provenance of a UAT case (design: `UatSource`). */
export const uatSourceSchema = z.enum(["existing", "user", "inferred"]);
export type UatSource = z.infer<typeof uatSourceSchema>;

/** Business criticality of a UAT case (design: `Criticality`). */
export const criticalitySchema = z.enum(["critical", "high", "medium", "low"]);
export type Criticality = z.infer<typeof criticalitySchema>;

/** Kind of behaviour a UAT case exercises (design: `UatType`). */
export const uatTypeSchema = z.enum(["api", "integration", "unit", "workflow"]);
export type UatType = z.infer<typeof uatTypeSchema>;

/** Lifecycle state of a UAT contract version (design: `UatStatus`). */
export const uatStatusSchema = z.enum(["DRAFT", "APPROVED", "LOCKED", "SUPERSEDED"]);
export type UatStatus = z.infer<typeof uatStatusSchema>;

/**
 * Resolved observation for a single case in one run (design: `Observation`).
 * Every expected/baseline/transformed outcome resolves to exactly one of these
 * (Requirement 14.1).
 */
export const observationSchema = z.enum(["pass", "fail", "blocked", "not_executed"]);
export type Observation = z.infer<typeof observationSchema>;

/**
 * The eight mutually-exclusive three-way classifications (design:
 * `Classification`, Requirement 14.2). The comparison engine assigns exactly
 * one of these per case.
 */
export const classificationSchema = z.enum([
  "UNCHANGED_PASS",
  "REGRESSION",
  "EXISTING_DEFECT",
  "IMPROVEMENT",
  "BLOCKED",
  "NOT_EXECUTED",
  "INTENTIONAL_CHANGE",
  "INCONCLUSIVE",
]);
export type Classification = z.infer<typeof classificationSchema>;

/**
 * Per-case comparison strategies (design: `ComparisonStrategy`, Requirement
 * 14.9). Ungoverned fields default to `exact`; `semantic` is enabled only for
 * explicitly approved cases.
 */
export const comparisonStrategySchema = z.enum([
  "exact",
  "schema",
  "subset",
  "ignoredFields",
  "regex",
  "numericTolerance",
  "dateTimeTolerance",
  "unordered",
  "customPredicate",
  "semantic",
]);
export type ComparisonStrategy = z.infer<typeof comparisonStrategySchema>;

/* -------------------------------------------------------------------------- */
/* Shared supporting schemas                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Record of who approved a versioned subject and when. Shared by UAT and
 * runtime contracts (design: `ApprovalRecord`). Shape is not fully specified in
 * the design; a minimal, reasonable shape is used.
 */
export const approvalRecordSchema = z
  .object({
    approvedBy: z.string().min(1),
    /** ISO-8601 timestamp of the approval. */
    approvedAt: z.string().min(1),
    note: z.string().optional(),
  })
  .strict();
export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;

/* -------------------------------------------------------------------------- */
/* UAT domain (Requirements 3, 4)                                             */
/* -------------------------------------------------------------------------- */

/**
 * A single actionable step in a UAT case (design: `UatStep`). Shape is not
 * fully specified in the design; a minimal, reasonable shape is used.
 */
export const uatStepSchema = z
  .object({
    action: z.string().min(1),
    input: z.unknown().optional(),
  })
  .strict();
export type UatStep = z.infer<typeof uatStepSchema>;

/**
 * An expected outcome assertion for a UAT case (design: `ExpectedOutcome`).
 * Shape is not fully specified in the design; a minimal, reasonable shape is
 * used that can express a targeted assertion with an optional per-field
 * comparison strategy.
 */
export const expectedOutcomeSchema = z
  .object({
    description: z.string().min(1),
    /** Dot/JSON path of the field the assertion targets, when applicable. */
    field: z.string().optional(),
    expectedValue: z.unknown().optional(),
    strategy: comparisonStrategySchema.optional(),
  })
  .strict();
export type ExpectedOutcome = z.infer<typeof expectedOutcomeSchema>;

/**
 * The comparison policy governing how a case's fields are compared (design:
 * `ComparisonPolicy`). Ungoverned fields default to `exact` (Requirement 14.9).
 * Shape is not fully specified in the design; a minimal, reasonable shape is
 * used: a default strategy plus optional per-field overrides and ignored
 * fields.
 */
export const comparisonPolicySchema = z
  .object({
    defaultStrategy: comparisonStrategySchema.default("exact"),
    fieldStrategies: z.record(z.string(), comparisonStrategySchema).optional(),
    ignoredFields: z.array(z.string()).optional(),
  })
  .strict();
export type ComparisonPolicy = z.infer<typeof comparisonPolicySchema>;

/**
 * A declared evidence requirement for a UAT case (design: `EvidenceRequirement`).
 * Shape is not fully specified in the design; a minimal, reasonable shape is
 * used that names the evidence kind and whether it is mandatory.
 */
export const evidenceRequirementSchema = z
  .object({
    kind: z.enum(["testResult", "httpPair", "log", "custom"]),
    required: z.boolean().default(true),
    description: z.string().optional(),
  })
  .strict();
export type EvidenceRequirement = z.infer<typeof evidenceRequirementSchema>;

/**
 * A single user-acceptance test case (design: `UatCase`). The `confidence`
 * field is bounded to the inclusive `[0.0, 1.0]` range and the `source`,
 * `criticality`, and `type` fields are constrained to their enums at the schema
 * level (Requirement 3.3).
 */
export const uatCaseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    source: uatSourceSchema,
    sourceRefs: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    criticality: criticalitySchema,
    type: uatTypeSchema,
    preconditions: z.array(z.string()),
    steps: z.array(uatStepSchema),
    expected: z.array(expectedOutcomeSchema),
    comparisonPolicy: comparisonPolicySchema,
    evidenceRequired: z.array(evidenceRequirementSchema),
  })
  .strict();
export type UatCase = z.infer<typeof uatCaseSchema>;

/**
 * A versioned collection of UAT cases (design: `UatContract`). `status` is
 * constrained to the lifecycle enum. `contentHash` is set when the contract is
 * LOCKED; `supersedesVersion` records version lineage.
 */
export const uatContractSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().nonnegative(),
    status: uatStatusSchema,
    cases: z.array(uatCaseSchema),
    assumptions: z.array(z.string()),
    uncoveredAreas: z.array(z.string()),
    /** sha256 content hash; present once LOCKED. */
    contentHash: z.string().optional(),
    supersedesVersion: z.number().int().nonnegative().optional(),
    approval: approvalRecordSchema.optional(),
  })
  .strict();
export type UatContract = z.infer<typeof uatContractSchema>;

/* -------------------------------------------------------------------------- */
/* Runtime contract domain (Requirements 5, 6)                                */
/* -------------------------------------------------------------------------- */

/**
 * Health check specification for a runtime (design: `HealthSpec`). Shape is not
 * fully specified in the design; a minimal, reasonable HTTP/command health
 * probe shape is used.
 */
export const healthSpecSchema = z
  .object({
    type: z.enum(["http", "tcp", "command"]),
    target: z.string().min(1),
    timeoutSeconds: z.number().positive().optional(),
    intervalSeconds: z.number().positive().optional(),
  })
  .strict();
export type HealthSpec = z.infer<typeof healthSpecSchema>;

/**
 * A reference to a secret resolved at runtime (design: `SecretRef`). Secret
 * values are never embedded; only a provider-scoped reference is carried
 * (Requirement 8.2).
 */
export const secretRefSchema = z
  .object({
    /** The environment variable or logical name the secret is bound to. */
    name: z.string().min(1),
    /** Where the value is fetched from at runtime (e.g. a Secrets Manager ARN). */
    ref: z.string().min(1),
    provider: z.enum(["secretsManager", "ssm", "env"]).optional(),
  })
  .strict();
export type SecretRef = z.infer<typeof secretRefSchema>;

/**
 * A dependent external service the runtime relies on (design:
 * `DependentService`). Shape is not fully specified in the design; a minimal,
 * reasonable shape is used.
 */
export const dependentServiceSchema = z
  .object({
    name: z.string().min(1),
    kind: z.string().min(1),
    endpoint: z.string().optional(),
  })
  .strict();
export type DependentService = z.infer<typeof dependentServiceSchema>;

/**
 * The condition that signals the application is ready for test execution
 * (design: `ReadinessCondition`). Shape is not fully specified in the design; a
 * minimal, reasonable shape is used.
 */
export const readinessConditionSchema = z
  .object({
    type: z.enum(["http", "tcp", "logLine", "command"]),
    target: z.string().min(1),
    timeoutSeconds: z.number().positive(),
  })
  .strict();
export type ReadinessCondition = z.infer<typeof readinessConditionSchema>;

/**
 * A test command and the suite category it belongs to (design: `TestSpec`).
 * Shape is not fully specified in the design; a minimal, reasonable shape is
 * used.
 */
export const testSpecSchema = z
  .object({
    kind: z.enum(["unit", "api", "integration"]),
    command: z.string().min(1),
    workingDirectory: z.string().optional(),
  })
  .strict();
export type TestSpec = z.infer<typeof testSpecSchema>;

/**
 * A dependency handling policy (design: `DependencyPolicy`). Shape is not fully
 * specified in the design; a minimal, reasonable shape naming the dependency
 * and its virtualization strategy is used.
 */
export const dependencyPolicySchema = z
  .object({
    name: z.string().min(1),
    strategy: z.enum(["real", "sandbox", "mock", "recordReplay", "stub", "ignored", "manual"]),
  })
  .strict();
export type DependencyPolicy = z.infer<typeof dependencyPolicySchema>;

/**
 * A fully specified, versionable runtime contract (design: `RuntimeContract`).
 * `target` distinguishes legacy from transformed runs, which are versioned
 * independently (Requirement 6.4).
 */
export const runtimeContractSchema = z
  .object({
    version: z.number().int().nonnegative(),
    target: z.enum(["legacy", "transformed"]),
    application: z.object({ name: z.string().min(1) }).strict(),
    runtime: z
      .object({
        strategy: z.string().min(1),
        adapter: z.string().min(1),
        version: z.string().min(1),
      })
      .strict(),
    build: z.object({ commands: z.array(z.string()) }).strict(),
    start: z
      .object({
        command: z.string().min(1),
        workingDirectory: z.string(),
        ports: z.array(z.number().int().nonnegative()),
      })
      .strict(),
    health: healthSpecSchema,
    environment: z
      .object({
        required: z.array(z.string()),
        secrets: z.array(secretRefSchema),
      })
      .strict(),
    services: z.array(dependentServiceSchema),
    fixtures: z
      .object({
        resetCommand: z.string().optional(),
        seedCommand: z.string().optional(),
      })
      .strict(),
    readiness: readinessConditionSchema,
    tests: z.array(testSpecSchema),
    dependencies: z.array(dependencyPolicySchema),
    approval: approvalRecordSchema.optional(),
  })
  .strict();
export type RuntimeContract = z.infer<typeof runtimeContractSchema>;

/* -------------------------------------------------------------------------- */
/* Evidence + baseline domain (Requirements 10, 11)                           */
/* -------------------------------------------------------------------------- */

/**
 * A by-reference pointer to a captured evidence artifact (design:
 * `EvidenceArtifactRef`). Evidence is streamed to artifact storage and only its
 * reference is carried in payloads (Requirement 10.3).
 */
export const evidenceArtifactRefSchema = z
  .object({
    artifactId: z.string().min(1),
    kind: z.enum(["testResult", "httpPair", "log", "custom"]),
    /** Storage URI, e.g. `s3://bucket/key`. */
    storageUri: z.string().min(1),
    sha256: z.string().min(1),
  })
  .strict();
export type EvidenceArtifactRef = z.infer<typeof evidenceArtifactRefSchema>;

/**
 * The immutable, LOCKED anchor of a baseline run (design: `BaselineManifest`).
 * `status` is pinned to the literal `"LOCKED"` and every hash is a sha256
 * string; verification recomputes these before a transformed comparison
 * (Requirement 11.4).
 */
export const baselineManifestSchema = z
  .object({
    baselineId: z.string().min(1),
    uatVersion: z.number().int().nonnegative(),
    sourceGitCommit: z.string().min(1),
    uatHash: z.string().min(1),
    runtimeHash: z.string().min(1),
    fixtureHash: z.string().min(1),
    evidenceManifestHash: z.string().min(1),
    approvedBy: z.string().min(1),
    /** ISO-8601 timestamp. */
    approvedAt: z.string().min(1),
    status: z.literal("LOCKED"),
  })
  .strict();
export type BaselineManifest = z.infer<typeof baselineManifestSchema>;

/* -------------------------------------------------------------------------- */
/* Case results + comparison domain (Requirement 14)                          */
/* -------------------------------------------------------------------------- */

/**
 * The result of evaluating a single assertion within a case (design:
 * `AssertionResult`). Shape is not fully specified in the design; a minimal,
 * reasonable shape is used.
 */
export const assertionResultSchema = z
  .object({
    description: z.string().min(1),
    passed: z.boolean(),
    strategy: comparisonStrategySchema.optional(),
    detail: z.string().optional(),
  })
  .strict();
export type AssertionResult = z.infer<typeof assertionResultSchema>;

/**
 * The normalized result of one case in one run (design: `NormalizedCaseResult`).
 * Carries only evidence references, never inline blobs (Requirement 10.3).
 */
export const normalizedCaseResultSchema = z
  .object({
    caseId: z.string().min(1),
    observation: observationSchema,
    assertions: z.array(assertionResultSchema),
    evidenceRefs: z.array(evidenceArtifactRefSchema),
  })
  .strict();
export type NormalizedCaseResult = z.infer<typeof normalizedCaseResultSchema>;

/**
 * A single field-level difference between baseline and transformed results
 * (design: `FieldDiff`). Shape is not fully specified in the design; a minimal,
 * reasonable shape is used.
 */
export const fieldDiffSchema = z
  .object({
    path: z.string(),
    baselineValue: z.unknown().optional(),
    transformedValue: z.unknown().optional(),
    strategy: comparisonStrategySchema.optional(),
  })
  .strict();
export type FieldDiff = z.infer<typeof fieldDiffSchema>;

/**
 * The three-way differential outcome for a single case (design:
 * `DifferentialCaseResult`). `expected`, `baseline`, and `transformed` each
 * resolve to an {@link Observation} and `classification` is exactly one of the
 * eight {@link Classification} values (Requirements 14.1, 14.2).
 */
export const differentialCaseResultSchema = z
  .object({
    caseId: z.string().min(1),
    expected: observationSchema,
    baseline: observationSchema,
    transformed: observationSchema,
    classification: classificationSchema,
    strategyApplied: z.array(comparisonStrategySchema),
    diff: z.array(fieldDiffSchema),
  })
  .strict();
export type DifferentialCaseResult = z.infer<typeof differentialCaseResultSchema>;

/* -------------------------------------------------------------------------- */
/* Confidence matrix domain (Requirement 15)                                  */
/* -------------------------------------------------------------------------- */

/** The six named confidence dimensions (design: `ConfidenceDimension.name`). */
export const confidenceDimensionNameSchema = z.enum([
  "Critical Workflows",
  "Approved UAT Execution",
  "API/Contract Compatibility",
  "Integration Behavior",
  "Environment Parity/Determinism",
  "Evidence Completeness",
]);
export type ConfidenceDimensionName = z.infer<typeof confidenceDimensionNameSchema>;

/**
 * One weighted confidence dimension (design: `ConfidenceDimension`). `name` is
 * constrained to exactly one of the six named dimensions (Requirement 15.1);
 * `dimensionScore = weightedPassed / weightedExecuted`.
 */
export const confidenceDimensionSchema = z
  .object({
    name: confidenceDimensionNameSchema,
    weight: z.number(),
    weightedPassed: z.number(),
    weightedExecuted: z.number(),
    dimensionScore: z.number(),
  })
  .strict();
export type ConfidenceDimension = z.infer<typeof confidenceDimensionSchema>;

/** The number of confidence dimensions the matrix must carry (exactly six). */
export const CONFIDENCE_DIMENSION_COUNT = 6 as const;

/**
 * The overall confidence matrix and gate (design: `ConfidenceMatrix`). Carries
 * exactly six dimensions (Requirement 15.1); the `gate` is constrained to the
 * three terminal outcomes.
 */
export const confidenceMatrixSchema = z
  .object({
    dimensions: z.array(confidenceDimensionSchema).length(CONFIDENCE_DIMENSION_COUNT),
    overallConfidence: z.number(),
    newRegressionCount: z.number().int().nonnegative(),
    excludedAreas: z.array(z.string()),
    gate: z.enum(["PASS", "INCONCLUSIVE", "FAIL"]),
  })
  .strict();
export type ConfidenceMatrix = z.infer<typeof confidenceMatrixSchema>;
