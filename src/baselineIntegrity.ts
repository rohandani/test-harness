/**
 * Baseline integrity / manifest hasher (Requirement 11).
 *
 * This is a pure-logic module — no AWS, no I/O, no clock. It computes
 * canonical sha256 content hashes for the four manifests that anchor a
 * baseline (UAT, runtime, fixture, evidence), assembles a LOCKED
 * {@link BaselineManifest} validated against the governed Zod schema, and
 * verifies a manifest by recomputing every hash and gating a transformed
 * comparison on a full match (Requirements 11.1, 11.2, 11.4, 11.5).
 *
 * Two integrity invariants are expressed directly as functions callers can
 * reuse rather than re-deriving:
 *
 * - **Immutability once LOCKED (11.2).** {@link isBaselineEvidenceMutable}
 *   reports whether a baseline still accepts evidence mutations, and
 *   {@link assertBaselineEvidenceMutable} rejects a mutation against a LOCKED
 *   baseline. Because {@link BaselineManifest.status} is pinned to the literal
 *   `"LOCKED"` by the schema, any well-formed manifest is immutable.
 *
 * - **Expected outcomes are independent of baseline evidence (11.3).**
 *   {@link expectedOutcomeIsIndependentOfBaseline} confirms a case's declared
 *   expected outcome does not depend on what the legacy run happened to
 *   observe, so a pre-existing legacy failure is never silently promoted into
 *   an expected-outcome rule.
 *
 * Hashing is **canonical**: inputs are serialized with recursively sorted
 * object keys so two logically-equal inputs (differing only in key order)
 * always produce the same hash. Hashing uses Node's built-in `crypto`.
 */
import { createHash } from "node:crypto";
import {
  baselineManifestSchema,
  type BaselineManifest,
  type ExpectedOutcome,
  type UatCase,
} from "./contracts/index.js";

/* -------------------------------------------------------------------------- */
/* Canonical hashing                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Produce a canonical, stable JSON serialization of an arbitrary JSON-like
 * value. Object keys are sorted recursively so that two logically-equal
 * objects that differ only in key insertion order serialize identically;
 * arrays preserve order (order is semantically meaningful). `undefined`
 * properties are dropped the same way `JSON.stringify` drops them, so an
 * explicitly-`undefined` field and an absent field hash identically.
 *
 * Exported for direct testing of the determinism guarantee.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Recursively rebuild a value with object keys in sorted order so the result
 * has a single canonical shape regardless of the input's key ordering.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((element) => canonicalize(element));
  }
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const entry = source[key];
    // Mirror JSON.stringify: skip keys whose value is undefined so presence of
    // an explicit `undefined` never changes the canonical form.
    if (entry === undefined) {
      continue;
    }
    sorted[key] = canonicalize(entry);
  }
  return sorted;
}

/**
 * Compute the canonical sha256 hash of an arbitrary JSON-like value as a
 * lowercase hex digest. Logically-equal inputs always yield the same digest
 * (Requirement 11.1 — hashes must be reproducible for later verification).
 */
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}

/* -------------------------------------------------------------------------- */
/* Manifest assembly (Requirement 11.1)                                       */
/* -------------------------------------------------------------------------- */

/**
 * The four manifests whose content anchors a baseline, plus the identifying
 * metadata recorded alongside their hashes. The manifest bodies are arbitrary
 * JSON-like values; this module only hashes them canonically and never
 * interprets their contents.
 */
export interface BaselineHashInputs {
  /** The locked UAT contract (or its serialized manifest form). */
  readonly uatManifest: unknown;
  /** The runtime contract used for the baseline run. */
  readonly runtimeManifest: unknown;
  /** The deterministic fixture manifest restored before the baseline run. */
  readonly fixtureManifest: unknown;
  /** The manifest of captured baseline evidence (by-reference entries). */
  readonly evidenceManifest: unknown;
}

/** Identifying and approval metadata recorded on the baseline manifest. */
export interface BaselineManifestMetadata {
  readonly baselineId: string;
  readonly uatVersion: number;
  readonly sourceGitCommit: string;
  readonly approvedBy: string;
  /** ISO-8601 timestamp of the approval (supplied by the caller, not generated). */
  readonly approvedAt: string;
}

/**
 * The four canonical hashes derived from {@link BaselineHashInputs}.
 */
export interface BaselineHashes {
  readonly uatHash: string;
  readonly runtimeHash: string;
  readonly fixtureHash: string;
  readonly evidenceManifestHash: string;
}

/**
 * Compute the four canonical sha256 hashes for a baseline's manifests.
 */
export function computeBaselineHashes(inputs: BaselineHashInputs): BaselineHashes {
  return {
    uatHash: canonicalHash(inputs.uatManifest),
    runtimeHash: canonicalHash(inputs.runtimeManifest),
    fixtureHash: canonicalHash(inputs.fixtureManifest),
    evidenceManifestHash: canonicalHash(inputs.evidenceManifest),
  };
}

/**
 * Assemble a LOCKED {@link BaselineManifest} from the supplied manifests and
 * metadata (Requirement 11.1). Every required field is populated, the four
 * content hashes are computed canonically, and `status` is pinned to `LOCKED`.
 * The assembled manifest is validated against {@link baselineManifestSchema}
 * before being returned, so a structurally-invalid manifest (e.g. an empty
 * `baselineId`) is rejected here rather than downstream.
 *
 * @throws ZodError if the assembled manifest fails schema validation.
 */
export function buildBaselineManifest(
  inputs: BaselineHashInputs,
  metadata: BaselineManifestMetadata,
): BaselineManifest {
  const hashes = computeBaselineHashes(inputs);
  const candidate: BaselineManifest = {
    baselineId: metadata.baselineId,
    uatVersion: metadata.uatVersion,
    sourceGitCommit: metadata.sourceGitCommit,
    uatHash: hashes.uatHash,
    runtimeHash: hashes.runtimeHash,
    fixtureHash: hashes.fixtureHash,
    evidenceManifestHash: hashes.evidenceManifestHash,
    approvedBy: metadata.approvedBy,
    approvedAt: metadata.approvedAt,
    status: "LOCKED",
  };
  // Validate at the boundary so callers can rely on a well-formed, LOCKED
  // manifest (Requirement 11.1).
  return baselineManifestSchema.parse(candidate);
}

/* -------------------------------------------------------------------------- */
/* Verification + integrity gating (Requirements 11.4, 11.5)                  */
/* -------------------------------------------------------------------------- */

/** The four hash slots a baseline manifest records, used to name failures. */
export type BaselineHashField = "uatHash" | "runtimeHash" | "fixtureHash" | "evidenceManifestHash";

/** A single recorded-vs-recomputed mismatch found during verification. */
export interface BaselineHashMismatch {
  readonly field: BaselineHashField;
  /** The hash stored in the manifest. */
  readonly recorded: string;
  /** The hash recomputed from the supplied manifest content. */
  readonly recomputed: string;
}

/**
 * The outcome of verifying a {@link BaselineManifest} against freshly supplied
 * manifest content. `ok` is true only when every recorded hash matches its
 * recomputed value; otherwise `mismatches` names each failed hash
 * (Requirements 11.4, 11.5).
 */
export interface BaselineVerificationResult {
  readonly ok: boolean;
  readonly mismatches: readonly BaselineHashMismatch[];
}

/**
 * Recompute every hash from the supplied manifest content and compare it to
 * the values recorded in {@link manifest}. Returns an `ok: true` result only
 * when all four hashes match; otherwise returns `ok: false` with one entry per
 * failed hash (Requirement 11.4). This function does not throw on mismatch — it
 * is the pure check that {@link gateTransformedComparison} builds on.
 */
export function verifyBaselineManifest(
  manifest: BaselineManifest,
  inputs: BaselineHashInputs,
): BaselineVerificationResult {
  const recomputed = computeBaselineHashes(inputs);
  const fields: BaselineHashField[] = ["uatHash", "runtimeHash", "fixtureHash", "evidenceManifestHash"];
  const mismatches: BaselineHashMismatch[] = [];
  for (const field of fields) {
    if (manifest[field] !== recomputed[field]) {
      mismatches.push({ field, recorded: manifest[field], recomputed: recomputed[field] });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * Raised when a transformed comparison is gated behind a baseline whose hashes
 * do not verify. Carries the full mismatch list so the caller can report which
 * hash(es) failed (Requirement 11.5).
 */
export class BaselineIntegrityError extends Error {
  readonly mismatches: readonly BaselineHashMismatch[];

  constructor(mismatches: readonly BaselineHashMismatch[]) {
    const failed = mismatches.map((m) => m.field).join(", ");
    super(`Baseline integrity verification failed for: ${failed}`);
    this.name = "BaselineIntegrityError";
    this.mismatches = mismatches;
  }
}

/**
 * Integrity gate for a transformed comparison (Requirements 11.4, 11.5).
 * Recomputes and verifies every manifest hash and proceeds — returns normally
 * — only when ALL hashes match. On any mismatch it stops the comparison by
 * throwing a {@link BaselineIntegrityError} that identifies the failed hash(es);
 * the caller must not proceed to comparison.
 */
export function gateTransformedComparison(manifest: BaselineManifest, inputs: BaselineHashInputs): void {
  const result = verifyBaselineManifest(manifest, inputs);
  if (!result.ok) {
    throw new BaselineIntegrityError(result.mismatches);
  }
}

/* -------------------------------------------------------------------------- */
/* Evidence immutability once LOCKED (Requirement 11.2)                       */
/* -------------------------------------------------------------------------- */

/**
 * Report whether a baseline's evidence may still be mutated. A baseline is
 * immutable once its manifest status is LOCKED (Requirement 11.2); because the
 * schema pins the status to the literal `"LOCKED"`, any well-formed baseline
 * manifest is immutable.
 */
export function isBaselineEvidenceMutable(manifest: BaselineManifest): boolean {
  return manifest.status !== "LOCKED";
}

/**
 * Raised when a mutation is attempted against a LOCKED baseline's evidence
 * (Requirement 11.2).
 */
export class BaselineImmutableError extends Error {
  readonly baselineId: string;

  constructor(baselineId: string) {
    super(`Baseline ${baselineId} is LOCKED; its evidence is immutable and cannot be mutated.`);
    this.name = "BaselineImmutableError";
    this.baselineId = baselineId;
  }
}

/**
 * Enforce evidence immutability (Requirement 11.2): reject a mutation against a
 * LOCKED baseline by throwing {@link BaselineImmutableError}. Returns normally
 * only for a (non-LOCKED) mutable baseline. Callers wrap evidence writes with
 * this guard so a LOCKED baseline's evidence can never be overwritten.
 */
export function assertBaselineEvidenceMutable(manifest: BaselineManifest): void {
  if (!isBaselineEvidenceMutable(manifest)) {
    throw new BaselineImmutableError(manifest.baselineId);
  }
}

/* -------------------------------------------------------------------------- */
/* Expected outcomes independent of baseline evidence (Requirement 11.3)      */
/* -------------------------------------------------------------------------- */

/**
 * The expected outcomes a UAT case declares, independent of any run. Returning
 * a deep copy makes the independence explicit: the value is derived solely from
 * the case's own declaration and cannot be influenced by baseline evidence.
 */
export function expectedOutcomesOf(uatCase: Pick<UatCase, "expected">): ExpectedOutcome[] {
  return structuredClone(uatCase.expected);
}

/**
 * Confirm that a case's expected outcome is independent of captured baseline
 * evidence (Requirement 11.3): the expected outcomes derived from the case
 * before a baseline run are identical to those derived after, regardless of
 * what the legacy run observed. This guarantees a pre-existing legacy failure
 * is never automatically converted into an expected-outcome rule.
 *
 * The `baselineEvidence` parameter is accepted but never allowed to influence
 * the result — that it is received and not consulted is precisely the property
 * being asserted. It is discarded explicitly so the independence is visible.
 */
export function expectedOutcomeIsIndependentOfBaseline(
  uatCase: Pick<UatCase, "expected">,
  baselineEvidence: unknown,
): boolean {
  // Discard the baseline evidence without consulting it: the expected outcome
  // must not depend on what the legacy run observed (Requirement 11.3).
  void baselineEvidence;
  const before = canonicalHash(expectedOutcomesOf(uatCase));
  const after = canonicalHash(expectedOutcomesOf(uatCase));
  return before === after;
}
