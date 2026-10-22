/**
 * Property 3: Generated UAT_Case structural validity.
 *
 * Feature: ai-transformation-validator, Property 3: Generated UAT_Case
 * structural validity.
 *
 * Validates: Requirements 3.3 — WHEN the Validator generates a UAT_Case, THE
 * Validator SHALL record the case id, title, a source classification that is
 * exactly one of existing/user/inferred, source references, a confidence value
 * between 0.0 and 1.0 inclusive, a criticality that is exactly one of
 * critical/high/medium/low, a type that is exactly one of
 * api/integration/unit/workflow, preconditions, steps, expected outcomes,
 * comparison policy, and required evidence.
 *
 * The property exercises the real {@link uatCaseSchema} (the single source of
 * truth for the UAT_Case shape, task 2.1) in both directions:
 *
 *   1. Positive — for any value drawn from a generator constrained to the valid
 *      input space, the schema accepts it, every required field is present, the
 *      `source`/`criticality`/`type` fields land in their enums, and
 *      `confidence` is within the inclusive `[0.0, 1.0]` bound.
 *
 *   2. Negative — for any single structural corruption (out-of-enum
 *      source/criticality/type, confidence outside `[0.0, 1.0]`, or a dropped
 *      required field), the schema rejects the value.
 *
 * Both run at a minimum of 100 iterations.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  uatCaseSchema,
  type Criticality,
  type UatSource,
  type UatType,
} from "./schemas.js";

/* -------------------------------------------------------------------------- */
/* Enum domains (the independent references the schema is checked against)    */
/* -------------------------------------------------------------------------- */

const SOURCES = ["existing", "user", "inferred"] as const satisfies readonly UatSource[];
const CRITICALITIES = ["critical", "high", "medium", "low"] as const satisfies readonly Criticality[];
const TYPES = ["api", "integration", "unit", "workflow"] as const satisfies readonly UatType[];

/** The field names a valid UAT_Case must carry (Requirement 3.3). */
const REQUIRED_FIELDS = [
  "id",
  "title",
  "source",
  "sourceRefs",
  "confidence",
  "criticality",
  "type",
  "preconditions",
  "steps",
  "expected",
  "comparisonPolicy",
  "evidenceRequired",
] as const;

/* -------------------------------------------------------------------------- */
/* Generators for the nested, governed shapes                                 */
/* -------------------------------------------------------------------------- */

const uatStepArb = fc.record(
  {
    action: fc.string({ minLength: 1, maxLength: 20 }),
    // `input` is optional + unknown; include it only sometimes.
    input: fc.oneof(fc.string({ maxLength: 10 }), fc.integer(), fc.boolean()),
  },
  { requiredKeys: ["action"] },
);

const expectedOutcomeArb = fc.record(
  {
    description: fc.string({ minLength: 1, maxLength: 20 }),
    field: fc.string({ maxLength: 10 }),
    strategy: fc.constantFrom(
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
    ),
  },
  { requiredKeys: ["description"] },
);

const comparisonPolicyArb = fc.record(
  {
    defaultStrategy: fc.constantFrom("exact", "schema", "subset", "regex", "unordered"),
    ignoredFields: fc.array(fc.string({ maxLength: 8 }), { maxLength: 4 }),
  },
  { requiredKeys: [] },
);

const evidenceRequirementArb = fc.record(
  {
    kind: fc.constantFrom("testResult", "httpPair", "log", "custom"),
    required: fc.boolean(),
    description: fc.string({ maxLength: 12 }),
  },
  { requiredKeys: ["kind"] },
);

/**
 * A generator for structurally valid UAT_Case values. `confidence` is drawn
 * from the inclusive `[0.0, 1.0]` range (including both bounds), and the three
 * enumerated fields are drawn only from their valid domains.
 */
const validUatCaseArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 16 }),
  title: fc.string({ minLength: 1, maxLength: 24 }),
  source: fc.constantFrom(...SOURCES),
  sourceRefs: fc.array(fc.string({ maxLength: 12 }), { maxLength: 5 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  criticality: fc.constantFrom(...CRITICALITIES),
  type: fc.constantFrom(...TYPES),
  preconditions: fc.array(fc.string({ maxLength: 16 }), { maxLength: 4 }),
  steps: fc.array(uatStepArb, { maxLength: 4 }),
  expected: fc.array(expectedOutcomeArb, { maxLength: 4 }),
  comparisonPolicy: comparisonPolicyArb,
  evidenceRequired: fc.array(evidenceRequirementArb, { maxLength: 4 }),
});

describe("Property 3: Generated UAT_Case structural validity (Requirement 3.3)", () => {
  it("accepts any generated UAT_Case: required fields present, enums in range, confidence in [0.0, 1.0]", () => {
    fc.assert(
      fc.property(validUatCaseArb, (candidate) => {
        const parsed = uatCaseSchema.safeParse(candidate);

        // The schema accepts the structurally valid case.
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;

        const uatCase = parsed.data;

        // Every required field is present (Requirement 3.3).
        for (const field of REQUIRED_FIELDS) {
          expect(uatCase).toHaveProperty(field);
          expect(uatCase[field]).not.toBeUndefined();
        }

        // Enumerated fields land in exactly their valid domains.
        expect(SOURCES).toContain(uatCase.source);
        expect(CRITICALITIES).toContain(uatCase.criticality);
        expect(TYPES).toContain(uatCase.type);

        // Confidence is within the inclusive [0.0, 1.0] bound.
        expect(uatCase.confidence).toBeGreaterThanOrEqual(0);
        expect(uatCase.confidence).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects an out-of-enum source, criticality, or type", () => {
    const fieldWithBadValue = fc.oneof(
      fc.record({ field: fc.constant("source" as const), value: fc.string({ minLength: 1 }).filter((s) => !SOURCES.includes(s as UatSource)) }),
      fc.record({ field: fc.constant("criticality" as const), value: fc.string({ minLength: 1 }).filter((s) => !CRITICALITIES.includes(s as Criticality)) }),
      fc.record({ field: fc.constant("type" as const), value: fc.string({ minLength: 1 }).filter((s) => !TYPES.includes(s as UatType)) }),
    );

    fc.assert(
      fc.property(validUatCaseArb, fieldWithBadValue, (base, corruption) => {
        const malformed = { ...base, [corruption.field]: corruption.value };
        expect(uatCaseSchema.safeParse(malformed).success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects a confidence outside the inclusive [0.0, 1.0] bound", () => {
    // Values strictly below 0 or strictly above 1 (NaN excluded so the single
    // failure mode under test is the range violation).
    const outOfRangeConfidence = fc
      .double({ noNaN: true })
      .filter((n) => n < 0 || n > 1);

    fc.assert(
      fc.property(validUatCaseArb, outOfRangeConfidence, (base, confidence) => {
        const malformed = { ...base, confidence };
        expect(uatCaseSchema.safeParse(malformed).success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects a UAT_Case missing any single required field", () => {
    fc.assert(
      fc.property(validUatCaseArb, fc.constantFrom(...REQUIRED_FIELDS), (base, fieldToDrop) => {
        const malformed: Record<string, unknown> = { ...base };
        delete malformed[fieldToDrop];
        expect(uatCaseSchema.safeParse(malformed).success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
