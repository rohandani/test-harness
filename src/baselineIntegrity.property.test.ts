/**
 * Property 14: Baseline manifest completeness and integrity gating.
 *
 * Feature: ai-transformation-validator, Property 14: Baseline manifest
 * completeness and integrity gating.
 *
 * Validates: Requirements 11.1, 11.4, 11.5 —
 *   11.1: On baseline completion, produce a Baseline_Manifest containing the
 *         baseline id, UAT version, source git commit, UAT hash, runtime hash,
 *         fixture hash, evidence manifest hash, approver, approval time, and
 *         status LOCKED. The manifest must be complete and LOCKED.
 *   11.4: Before a transformed comparison, verify the Baseline_Manifest hashes.
 *   11.5: If a Baseline_Manifest hash verification fails, stop the comparison
 *         and report the integrity failure.
 *
 * The property exercises the real pure-logic module ({@link buildBaselineManifest},
 * {@link verifyBaselineManifest}, {@link gateTransformedComparison}) in both
 * directions, each at a minimum of 100 iterations:
 *
 *   1. Completeness + pass path — for any generated manifest inputs/metadata,
 *      the assembled manifest carries every required field with status LOCKED,
 *      and verification against the ORIGINAL inputs succeeds so the gate
 *      proceeds (Requirements 11.1, 11.4).
 *
 *   2. Integrity-failure path — for any non-empty subset of the four hashed
 *      manifests mutated to a genuinely-different value, verification fails,
 *      the mismatch list names exactly the tampered hash field(s), and the gate
 *      stops the comparison by throwing a {@link BaselineIntegrityError}
 *      (Requirement 11.5).
 *
 * Together these establish the "iff" gating: the comparison proceeds exactly
 * when every recorded hash matches, and stops with an integrity failure
 * otherwise.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BaselineIntegrityError,
  buildBaselineManifest,
  computeBaselineHashes,
  gateTransformedComparison,
  verifyBaselineManifest,
  type BaselineHashField,
  type BaselineHashInputs,
  type BaselineManifestMetadata,
} from "./baselineIntegrity.js";

/* -------------------------------------------------------------------------- */
/* References the schema/implementation are checked against                   */
/* -------------------------------------------------------------------------- */

/** Every field a complete, LOCKED Baseline_Manifest must carry (Req 11.1). */
const REQUIRED_MANIFEST_FIELDS = [
  "baselineId",
  "uatVersion",
  "sourceGitCommit",
  "uatHash",
  "runtimeHash",
  "fixtureHash",
  "evidenceManifestHash",
  "approvedBy",
  "approvedAt",
  "status",
] as const;

/** The four hashed manifest inputs and the hash field each one anchors. */
const HASHED_INPUTS = [
  { input: "uatManifest", field: "uatHash" },
  { input: "runtimeManifest", field: "runtimeHash" },
  { input: "fixtureManifest", field: "fixtureHash" },
  { input: "evidenceManifest", field: "evidenceManifestHash" },
] as const satisfies readonly { input: keyof BaselineHashInputs; field: BaselineHashField }[];

/* -------------------------------------------------------------------------- */
/* Generators constrained to the valid input space                            */
/* -------------------------------------------------------------------------- */

/**
 * An arbitrary JSON-like manifest body. The bodies are only ever hashed
 * canonically — the module never interprets their contents — so any JSON value
 * is a valid input. Depth is bounded to keep generation fast.
 */
const manifestBodyArb: fc.Arbitrary<unknown> = fc.jsonValue({ depthSize: "small" });

const hashInputsArb: fc.Arbitrary<BaselineHashInputs> = fc.record({
  uatManifest: manifestBodyArb,
  runtimeManifest: manifestBodyArb,
  fixtureManifest: manifestBodyArb,
  evidenceManifest: manifestBodyArb,
});

/**
 * Metadata constrained to the schema's valid space: non-empty strings for the
 * free-text fields and a non-negative integer UAT version.
 */
const metadataArb: fc.Arbitrary<BaselineManifestMetadata> = fc.record({
  baselineId: fc.string({ minLength: 1, maxLength: 16 }),
  uatVersion: fc.nat({ max: 1_000 }),
  sourceGitCommit: fc.string({ minLength: 1, maxLength: 40 }),
  approvedBy: fc.string({ minLength: 1, maxLength: 16 }),
  // Build the ISO-8601 approval timestamp from a bounded epoch so it is always
  // a valid, non-empty string (fc.date can otherwise yield an invalid Date).
  approvedAt: fc
    .integer({
      min: Date.UTC(2000, 0, 1),
      max: Date.UTC(2100, 0, 1),
    })
    .map((epochMs) => new Date(epochMs).toISOString()),
});

/**
 * Replace the body of one hashed input with a value whose canonical hash
 * differs from the original. We draw candidate replacements and keep the first
 * whose hash actually changes, so a tamper is guaranteed to move the hash (and
 * never accidentally hash-collides back to the original).
 */
function tamperInput(original: BaselineHashInputs, input: keyof BaselineHashInputs, replacement: unknown): BaselineHashInputs {
  return { ...original, [input]: replacement };
}

describe("Property 14: Baseline manifest completeness and integrity gating (Requirements 11.1, 11.4, 11.5)", () => {
  it("assembles a complete, LOCKED manifest and the gate proceeds when every recorded hash matches", () => {
    fc.assert(
      fc.property(hashInputsArb, metadataArb, (inputs, metadata) => {
        const manifest = buildBaselineManifest(inputs, metadata);

        // Completeness: every required field is present and defined (Req 11.1).
        for (const field of REQUIRED_MANIFEST_FIELDS) {
          expect(manifest).toHaveProperty(field);
          expect(manifest[field]).not.toBeUndefined();
        }

        // Status is pinned LOCKED (Req 11.1).
        expect(manifest.status).toBe("LOCKED");

        // The recorded hashes equal the canonical hashes of the inputs.
        const recomputed = computeBaselineHashes(inputs);
        expect({
          uatHash: manifest.uatHash,
          runtimeHash: manifest.runtimeHash,
          fixtureHash: manifest.fixtureHash,
          evidenceManifestHash: manifest.evidenceManifestHash,
        }).toEqual(recomputed);

        // Verification against the ORIGINAL inputs matches every hash, so the
        // gate proceeds — no mismatches, no throw (Req 11.4).
        const result = verifyBaselineManifest(manifest, inputs);
        expect(result.ok).toBe(true);
        expect(result.mismatches).toEqual([]);
        expect(() => gateTransformedComparison(manifest, inputs)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it("stops the comparison with an integrity failure naming exactly the mutated hash(es)", () => {
    fc.assert(
      fc.property(
        hashInputsArb,
        metadataArb,
        // A non-empty subset of the four hashed inputs to tamper with.
        fc.subarray([...HASHED_INPUTS], { minLength: 1 }),
        // One candidate replacement body per potentially-tampered input.
        fc.array(manifestBodyArb, { minLength: 4, maxLength: 4 }),
        (inputs, metadata, toTamper, replacements) => {
          const manifest = buildBaselineManifest(inputs, metadata);

          // Apply a genuine mutation to each selected input: only keep the
          // tamper if it actually changes that input's canonical hash, so this
          // run exercises a real integrity violation (not a no-op or collision).
          const originalHashes = computeBaselineHashes(inputs);
          let tampered: BaselineHashInputs = inputs;
          const expectedFailedFields = new Set<BaselineHashField>();

          toTamper.forEach(({ input, field }, index) => {
            const candidate = tamperInput(tampered, input, replacements[index]);
            if (computeBaselineHashes(candidate)[field] !== originalHashes[field]) {
              tampered = candidate;
              expectedFailedFields.add(field);
            }
          });

          // If no selected tamper actually moved a hash (e.g. the candidate was
          // canonically equal to the original), there is nothing to assert for
          // the failure direction — skip to avoid a false negative.
          fc.pre(expectedFailedFields.size > 0);

          // Verification fails and names exactly the tampered hash field(s)
          // (Req 11.4), and the gate stops the comparison by throwing a
          // BaselineIntegrityError carrying the same mismatches (Req 11.5).
          const result = verifyBaselineManifest(manifest, tampered);
          expect(result.ok).toBe(false);
          expect(new Set(result.mismatches.map((m) => m.field))).toEqual(expectedFailedFields);

          // Each mismatch reports the manifest's recorded hash vs the recomputed
          // (tampered) hash.
          const tamperedHashes = computeBaselineHashes(tampered);
          for (const mismatch of result.mismatches) {
            expect(mismatch.recorded).toBe(manifest[mismatch.field]);
            expect(mismatch.recomputed).toBe(tamperedHashes[mismatch.field]);
          }

          let thrown: unknown;
          try {
            gateTransformedComparison(manifest, tampered);
          } catch (error) {
            thrown = error;
          }
          expect(thrown).toBeInstanceOf(BaselineIntegrityError);
          expect(new Set((thrown as BaselineIntegrityError).mismatches.map((m) => m.field))).toEqual(
            expectedFailedFields,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
