/**
 * Property 15: Expected outcomes are independent of baseline evidence.
 *
 * Feature: ai-transformation-validator, Property 15: Expected outcomes are
 * independent of baseline evidence.
 *
 * Validates: Requirements 11.3 — a case's expected outcome is derived solely
 * from its own declaration and is identical before and after baseline capture,
 * regardless of what the legacy (baseline) run observed. A pre-existing legacy
 * failure is therefore never silently promoted into an expected-outcome rule.
 *
 * The property exercises the real pure-logic module
 * ({@link expectedOutcomesOf}, {@link expectedOutcomeIsIndependentOfBaseline})
 * at a minimum of 100 iterations. For any generated UAT case `expected` array
 * and any JSON-like baseline evidence — including evidence shaped like a legacy
 * failure — it establishes:
 *
 *   1. Stability — the expected outcomes derived "before" baseline capture are
 *      deeply equal to those derived "after", so the baseline evidence value
 *      never changes the declared expectation (Requirement 11.3).
 *
 *   2. Independence predicate — {@link expectedOutcomeIsIndependentOfBaseline}
 *      returns true for every case and every baseline evidence value, including
 *      legacy-failure-shaped evidence that is deliberately never consulted.
 *
 *   3. Defensive copy — mutating the returned outcomes does not affect the
 *      source case, reinforcing that the expectation is owned by the case's own
 *      declaration and cannot be influenced after the fact.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  expectedOutcomeIsIndependentOfBaseline,
  expectedOutcomesOf,
} from "./baselineIntegrity.js";
import { type ExpectedOutcome } from "./contracts/index.js";

/* -------------------------------------------------------------------------- */
/* Generators constrained to the valid input space                           */
/* -------------------------------------------------------------------------- */

/** The ten governed comparison strategies (schema: `comparisonStrategySchema`). */
const COMPARISON_STRATEGIES = [
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
] as const;

/**
 * An arbitrary {@link ExpectedOutcome} constrained to the schema's valid space:
 * a non-empty `description`, with the optional `field`, `expectedValue`, and
 * `strategy` present only some of the time.
 */
const expectedOutcomeArb: fc.Arbitrary<ExpectedOutcome> = fc.record(
  {
    description: fc.string({ minLength: 1, maxLength: 20 }),
    field: fc.string({ maxLength: 12 }),
    // `expectedValue` is an optional unknown — any JSON-like value is valid.
    expectedValue: fc.jsonValue({ depthSize: "small" }),
    strategy: fc.constantFrom(...COMPARISON_STRATEGIES),
  },
  { requiredKeys: ["description"] },
);

/** A case's `expected` outcomes array (`ExpectedOutcome[]`). */
const expectedOutcomesArb: fc.Arbitrary<ExpectedOutcome[]> = fc.array(expectedOutcomeArb, {
  maxLength: 6,
});

/**
 * Arbitrary baseline evidence: any JSON-like value. This stands in for whatever
 * the legacy run happened to capture, and is deliberately never consulted by
 * the functions under test.
 */
const baselineEvidenceArb: fc.Arbitrary<unknown> = fc.jsonValue({ depthSize: "small" });

/**
 * Baseline evidence deliberately shaped like a legacy failure, to prove that a
 * pre-existing failure is never promoted into an expected-outcome rule — it is
 * never even read.
 */
const legacyFailureEvidenceArb: fc.Arbitrary<unknown> = fc.record({
  observation: fc.constant("fail"),
  caseId: fc.string({ minLength: 1, maxLength: 12 }),
  detail: fc.string({ maxLength: 24 }),
});

describe("Property 15: Expected outcomes are independent of baseline evidence (Requirement 11.3)", () => {
  it("derives identical expected outcomes before and after baseline capture, independent of the evidence", () => {
    fc.assert(
      fc.property(
        expectedOutcomesArb,
        // Mix ordinary JSON-like evidence with legacy-failure-shaped evidence so
        // both the general case and the "never promote a legacy failure" case
        // are exercised.
        fc.oneof(baselineEvidenceArb, legacyFailureEvidenceArb),
        (expected, baselineEvidence) => {
          const uatCase = { expected };

          // "Before" baseline capture: the declared expectation.
          const before = expectedOutcomesOf(uatCase);

          // "After" baseline capture: whatever evidence the legacy run produced
          // exists now, but the expectation is re-derived from the case alone.
          void baselineEvidence;
          const after = expectedOutcomesOf(uatCase);

          // The expected outcome is identical before and after — the baseline
          // evidence value never influences it (Requirement 11.3).
          expect(after).toEqual(before);
          expect(after).toEqual(expected);

          // The independence predicate holds for this case and this evidence,
          // including legacy-failure-shaped evidence.
          expect(expectedOutcomeIsIndependentOfBaseline(uatCase, baselineEvidence)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns a defensive copy: mutating the derived outcomes never affects the source case", () => {
    fc.assert(
      fc.property(expectedOutcomesArb, baselineEvidenceArb, (expected, baselineEvidence) => {
        // Snapshot the source so we can prove it is untouched after mutation.
        const snapshot = structuredClone(expected);
        const uatCase = { expected };

        const derived = expectedOutcomesOf(uatCase);

        // Mutate the returned array and its nested objects.
        derived.push({ description: "injected after the fact" });
        if (derived.length > 1) {
          derived[0] = { ...derived[0], description: "mutated-description" };
        }

        // The source case's expectation is unchanged by any mutation of the
        // derived copy — the expectation is owned solely by the case's own
        // declaration (Requirement 11.3).
        expect(uatCase.expected).toEqual(snapshot);

        // And independence still holds for the (unmodified) source case.
        expect(expectedOutcomeIsIndependentOfBaseline(uatCase, baselineEvidence)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
