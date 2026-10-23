/**
 * Unit tests for the baseline integrity / manifest hasher (Requirement 11).
 *
 * These example-based tests pin the core behaviors of the pure-logic module:
 * canonical hashing determinism (11.1), manifest completeness + LOCKED status
 * (11.1), the verification pass path (11.4), the verification failure path that
 * names the failed hash(es) and stops the comparison (11.5), immutability of a
 * LOCKED baseline's evidence (11.2), and expected-outcome independence from
 * baseline evidence (11.3). Property-based coverage lives in the optional
 * subtasks 3.2/3.3.
 */
import { describe, expect, it } from "vitest";
import {
  assertBaselineEvidenceMutable,
  BaselineImmutableError,
  BaselineIntegrityError,
  buildBaselineManifest,
  canonicalHash,
  canonicalStringify,
  computeBaselineHashes,
  expectedOutcomeIsIndependentOfBaseline,
  expectedOutcomesOf,
  gateTransformedComparison,
  isBaselineEvidenceMutable,
  verifyBaselineManifest,
  type BaselineHashInputs,
  type BaselineManifestMetadata,
} from "./baselineIntegrity.js";
import type { BaselineManifest, UatCase } from "./contracts/index.js";

/** A representative set of four distinct manifest bodies. */
const inputs: BaselineHashInputs = {
  uatManifest: { id: "uat", version: 1, cases: [{ id: "c1" }, { id: "c2" }] },
  runtimeManifest: { target: "legacy", start: { command: "node server.js", ports: [8080] } },
  fixtureManifest: { seed: "fixtures/seed.sql", reset: true },
  evidenceManifest: { artifacts: [{ artifactId: "a1", sha256: "deadbeef" }] },
};

const metadata: BaselineManifestMetadata = {
  baselineId: "baseline-v1",
  uatVersion: 1,
  sourceGitCommit: "abc1234",
  approvedBy: "alice",
  approvedAt: "2024-01-01T00:00:00.000Z",
};

describe("canonical hashing (Requirement 11.1)", () => {
  it("produces identical hashes for logically-equal inputs with differing key order", () => {
    const a = { x: 1, y: { b: 2, a: 3 }, list: [{ p: 1, q: 2 }] };
    const b = { y: { a: 3, b: 2 }, x: 1, list: [{ q: 2, p: 1 }] };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it("treats an explicitly-undefined field the same as an absent field", () => {
    expect(canonicalHash({ a: 1, b: undefined })).toBe(canonicalHash({ a: 1 }));
  });

  it("preserves array order (order is semantically meaningful)", () => {
    expect(canonicalHash([1, 2, 3])).not.toBe(canonicalHash([3, 2, 1]));
  });

  it("produces different hashes for different content", () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });

  it("emits a lowercase 64-char hex sha256 digest", () => {
    expect(canonicalHash(inputs.uatManifest)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("buildBaselineManifest (Requirement 11.1)", () => {
  it("assembles a complete manifest with status LOCKED and canonical hashes", () => {
    const manifest = buildBaselineManifest(inputs, metadata);
    const hashes = computeBaselineHashes(inputs);

    expect(manifest).toEqual({
      baselineId: "baseline-v1",
      uatVersion: 1,
      sourceGitCommit: "abc1234",
      uatHash: hashes.uatHash,
      runtimeHash: hashes.runtimeHash,
      fixtureHash: hashes.fixtureHash,
      evidenceManifestHash: hashes.evidenceManifestHash,
      approvedBy: "alice",
      approvedAt: "2024-01-01T00:00:00.000Z",
      status: "LOCKED",
    });
  });

  it("rejects structurally-invalid metadata via schema validation", () => {
    expect(() => buildBaselineManifest(inputs, { ...metadata, baselineId: "" })).toThrow();
  });

  it("is deterministic across repeated assembly of equal inputs", () => {
    expect(buildBaselineManifest(inputs, metadata)).toEqual(buildBaselineManifest(inputs, metadata));
  });
});

describe("verifyBaselineManifest + gateTransformedComparison (Requirements 11.4, 11.5)", () => {
  it("verifies and proceeds when every recorded hash matches the recomputed hash", () => {
    const manifest = buildBaselineManifest(inputs, metadata);
    const result = verifyBaselineManifest(manifest, inputs);

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(() => gateTransformedComparison(manifest, inputs)).not.toThrow();
  });

  it("stops and names the single failed hash when one manifest changed", () => {
    const manifest = buildBaselineManifest(inputs, metadata);
    const tampered: BaselineHashInputs = { ...inputs, evidenceManifest: { artifacts: [{ artifactId: "TAMPERED" }] } };

    const result = verifyBaselineManifest(manifest, tampered);
    expect(result.ok).toBe(false);
    expect(result.mismatches.map((m) => m.field)).toEqual(["evidenceManifestHash"]);
    expect(result.mismatches[0]).toMatchObject({
      recorded: manifest.evidenceManifestHash,
      recomputed: canonicalHash(tampered.evidenceManifest),
    });

    try {
      gateTransformedComparison(manifest, tampered);
      throw new Error("expected gateTransformedComparison to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(BaselineIntegrityError);
      expect((error as BaselineIntegrityError).mismatches.map((m) => m.field)).toEqual([
        "evidenceManifestHash",
      ]);
      expect((error as BaselineIntegrityError).message).toContain("evidenceManifestHash");
    }
  });

  it("names every failed hash when multiple manifests changed", () => {
    const manifest = buildBaselineManifest(inputs, metadata);
    const tampered: BaselineHashInputs = {
      uatManifest: { id: "different" },
      runtimeManifest: { target: "different" },
      fixtureManifest: inputs.fixtureManifest,
      evidenceManifest: { artifacts: [] },
    };

    const result = verifyBaselineManifest(manifest, tampered);
    expect(result.ok).toBe(false);
    expect(new Set(result.mismatches.map((m) => m.field))).toEqual(
      new Set(["uatHash", "runtimeHash", "evidenceManifestHash"]),
    );
    expect(() => gateTransformedComparison(manifest, tampered)).toThrow(BaselineIntegrityError);
  });
});

describe("baseline evidence immutability once LOCKED (Requirement 11.2)", () => {
  it("reports a LOCKED baseline as immutable and rejects mutation", () => {
    const manifest = buildBaselineManifest(inputs, metadata);

    expect(isBaselineEvidenceMutable(manifest)).toBe(false);
    expect(() => assertBaselineEvidenceMutable(manifest)).toThrow(BaselineImmutableError);
    expect(() => assertBaselineEvidenceMutable(manifest)).toThrow(/baseline-v1/);
  });
});

describe("expected outcomes independent of baseline evidence (Requirement 11.3)", () => {
  const uatCase: Pick<UatCase, "expected"> = {
    expected: [
      { description: "returns 200 OK", field: "status", expectedValue: 200, strategy: "exact" },
      { description: "body matches schema", strategy: "schema" },
    ],
  };

  it("derives identical expected outcomes regardless of what baseline observed", () => {
    const legacyPassed = { observation: "pass" };
    const legacyFailed = { observation: "fail" };

    expect(expectedOutcomesOf(uatCase)).toEqual(uatCase.expected);
    expect(expectedOutcomeIsIndependentOfBaseline(uatCase, legacyPassed)).toBe(true);
    expect(expectedOutcomeIsIndependentOfBaseline(uatCase, legacyFailed)).toBe(true);
    // A legacy failure does not change the declared expected outcome.
    expect(canonicalHash(expectedOutcomesOf(uatCase))).toBe(
      canonicalHash([
        { description: "returns 200 OK", field: "status", expectedValue: 200, strategy: "exact" },
        { description: "body matches schema", strategy: "schema" },
      ]),
    );
  });

  it("returns a defensive copy so callers cannot retroactively mutate the expected outcome", () => {
    const copy = expectedOutcomesOf(uatCase);
    const [firstCopy] = copy;
    const [firstOriginal] = uatCase.expected;
    if (firstCopy === undefined || firstOriginal === undefined) {
      throw new Error("expected at least one expected-outcome entry");
    }
    firstCopy.description = "mutated";
    expect(firstOriginal.description).toBe("returns 200 OK");
  });
});

describe("manifest type surface", () => {
  it("exposes a LOCKED-status manifest assignable to BaselineManifest", () => {
    const manifest: BaselineManifest = buildBaselineManifest(inputs, metadata);
    expect(manifest.status).toBe("LOCKED");
  });
});
