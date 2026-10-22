/**
 * Unit tests for Zod schema rejection of malformed tool I/O (Requirement 1.3).
 *
 * Requirement 1.3: "THE MCP_Server SHALL validate the structure of every tool
 * input and output against a defined schema." These tests assert that
 * well-formed payloads pass validation and that malformed payloads — missing
 * required fields, wrong types, out-of-enum values, and out-of-range values —
 * are rejected by the {@link ToolRouter} with a {@link ToolValidationError}
 * carrying Zod schema issues.
 *
 * The router's I/O validation is exercised via a single representative tool
 * whose input and output schemas cover the four malformation categories, so
 * both the input and the output validation paths are tested against each.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRouter, ToolValidationError, type ToolDefinition } from "./toolRouter.js";

/**
 * A read-only tool whose schemas exercise every malformation category:
 * - required field (`name`, `kind`, `score`)
 * - typed field (`name: string`, `score: number`)
 * - enumerated field (`kind` in a fixed set)
 * - range-bounded field (`score` in [0, 100])
 *
 * The handler echoes the validated input straight through so the output schema
 * (identical in shape) validates the same payload the input schema accepted —
 * this lets us drive malformed *output* by passing a payload the handler
 * returns unchanged that the output schema is set up to reject.
 */
const kindEnum = z.enum(["unit", "api", "integration"]);

function profileTool(): ToolDefinition<z.ZodRawShape, z.ZodRawShape> {
  return {
    name: "profile",
    description: "Validate and echo a case profile.",
    stateChanging: false,
    inputSchema: z
      .object({
        name: z.string().min(1),
        kind: kindEnum,
        score: z.number().min(0).max(100),
      })
      .strict(),
    outputSchema: z
      .object({
        name: z.string().min(1),
        kind: kindEnum,
        score: z.number().min(0).max(100),
      })
      .strict(),
    handler: async (input) => input as { name: string; kind: string; score: number },
  };
}

/** A well-formed payload accepted by both the input and output schema. */
const wellFormed = { name: "login", kind: "api", score: 87 } as const;

describe("Zod I/O schema validation accepts well-formed payloads (Requirement 1.3)", () => {
  it("accepts a well-formed input payload and returns the validated output", async () => {
    const router = new ToolRouter();
    router.register(profileTool());

    const { output, replayed } = await router.invoke("profile", wellFormed);

    expect(output).toEqual(wellFormed);
    expect(replayed).toBe(false);
  });

  it("accepts boundary-valid numeric values (inclusive range bounds)", async () => {
    const router = new ToolRouter();
    router.register(profileTool());

    const low = await router.invoke("profile", { ...wellFormed, score: 0 });
    const high = await router.invoke("profile", { ...wellFormed, score: 100 });

    expect(low.output).toMatchObject({ score: 0 });
    expect(high.output).toMatchObject({ score: 100 });
  });
});

describe("Zod input schema rejects malformed input with schema errors (Requirement 1.3)", () => {
  it("rejects a payload with a missing required field", async () => {
    const router = new ToolRouter();
    router.register(profileTool());

    const promise = router.invoke("profile", { kind: "api", score: 87 });
    await expect(promise).rejects.toBeInstanceOf(ToolValidationError);
    await expect(promise).rejects.toMatchObject({ phase: "input", toolName: "profile" });
  });

  it("rejects a payload with a wrong-typed field", async () => {
    const router = new ToolRouter();
    router.register(profileTool());

    await expect(
      router.invoke("profile", { ...wellFormed, score: "high" }),
    ).rejects.toBeInstanceOf(ToolValidationError);
    await expect(
      router.invoke("profile", { ...wellFormed, name: 123 }),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });

  it("rejects a payload with an out-of-enum value", async () => {
    const router = new ToolRouter();
    router.register(profileTool());

    await expect(
      router.invoke("profile", { ...wellFormed, kind: "smoke" }),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });

  it("rejects a payload with an out-of-range value", async () => {
    const router = new ToolRouter();
    router.register(profileTool());

    await expect(
      router.invoke("profile", { ...wellFormed, score: -1 }),
    ).rejects.toBeInstanceOf(ToolValidationError);
    await expect(
      router.invoke("profile", { ...wellFormed, score: 101 }),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });

  it("rejects unexpected extra fields under a strict schema", async () => {
    const router = new ToolRouter();
    router.register(profileTool());

    await expect(
      router.invoke("profile", { ...wellFormed, unexpected: true }),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });

  it("surfaces the offending field path in the schema error", async () => {
    const router = new ToolRouter();
    router.register(profileTool());

    try {
      await router.invoke("profile", { ...wellFormed, kind: "smoke" });
      expect.unreachable("expected a ToolValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolValidationError);
      const issues = (error as ToolValidationError).issues;
      expect(issues.some((issue) => issue.path.join(".") === "kind")).toBe(true);
    }
  });
});

describe("Zod output schema rejects malformed handler output with schema errors (Requirement 1.3)", () => {
  /** Register a tool that returns `badOutput` verbatim from its handler. */
  function toolReturning(badOutput: unknown): ToolRouter {
    const router = new ToolRouter();
    router.register({
      name: "emit",
      description: "Emit a fixed, possibly-malformed output.",
      stateChanging: false,
      inputSchema: z.object({}).strict(),
      outputSchema: z
        .object({
          name: z.string().min(1),
          kind: kindEnum,
          score: z.number().min(0).max(100),
        })
        .strict(),
      handler: async () =>
        badOutput as unknown as { name: string; kind: "unit" | "api" | "integration"; score: number },
    });
    return router;
  }

  it("accepts a well-formed handler output", async () => {
    const router = toolReturning(wellFormed);
    const { output } = await router.invoke("emit", {});
    expect(output).toEqual(wellFormed);
  });

  it("rejects handler output with a missing required field", async () => {
    const router = toolReturning({ kind: "api", score: 87 });
    const promise = router.invoke("emit", {});
    await expect(promise).rejects.toBeInstanceOf(ToolValidationError);
    await expect(promise).rejects.toMatchObject({ phase: "output", toolName: "emit" });
  });

  it("rejects handler output with a wrong-typed field", async () => {
    const router = toolReturning({ ...wellFormed, score: "high" });
    await expect(router.invoke("emit", {})).rejects.toMatchObject({ phase: "output" });
  });

  it("rejects handler output with an out-of-enum value", async () => {
    const router = toolReturning({ ...wellFormed, kind: "smoke" });
    await expect(router.invoke("emit", {})).rejects.toMatchObject({ phase: "output" });
  });

  it("rejects handler output with an out-of-range value", async () => {
    const router = toolReturning({ ...wellFormed, score: 101 });
    await expect(router.invoke("emit", {})).rejects.toMatchObject({ phase: "output" });
  });
});
