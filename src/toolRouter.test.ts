import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  idempotencyKeySchema,
  ToolRegistrationError,
  ToolRouter,
  ToolValidationError,
  type ToolDefinition,
} from "./toolRouter.js";
import { InMemoryIdempotencyStore } from "./idempotencyStore.js";

/** A read-only tool that upper-cases its input value. */
function echoTool(): ToolDefinition<z.ZodRawShape, z.ZodRawShape> {
  return {
    name: "echo",
    description: "Echo the value in upper case.",
    stateChanging: false,
    inputSchema: z.object({ value: z.string().min(1) }).strict(),
    outputSchema: z.object({ value: z.string() }).strict(),
    handler: async (input) => ({ value: String(input.value).toUpperCase() }),
  };
}

/**
 * A state-changing tool whose handler increments a side-effect counter so a
 * replay can be detected by observing that the counter did not advance.
 */
function countingTool(counter: { calls: number }): ToolDefinition<z.ZodRawShape, z.ZodRawShape> {
  return {
    name: "mutate",
    description: "Mutate state and report the call ordinal.",
    stateChanging: true,
    inputSchema: z.object({ payload: z.string().min(1), idempotencyKey: idempotencyKeySchema }).strict(),
    outputSchema: z.object({ callOrdinal: z.number().int() }).strict(),
    handler: async () => {
      counter.calls += 1;
      return { callOrdinal: counter.calls };
    },
  };
}

describe("ToolRouter registration", () => {
  it("rejects duplicate tool names", () => {
    const router = new ToolRouter();
    router.register(echoTool());
    expect(() => router.register(echoTool())).toThrow(ToolRegistrationError);
  });

  it("rejects a state-changing tool that lacks an idempotencyKey field", () => {
    const router = new ToolRouter();
    const bad: ToolDefinition<z.ZodRawShape, z.ZodRawShape> = {
      name: "bad",
      description: "missing idempotencyKey",
      stateChanging: true,
      inputSchema: z.object({ payload: z.string() }).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ ok: true }),
    };
    expect(() => router.register(bad)).toThrow(ToolRegistrationError);
  });

  it("lists registered discrete tool names", () => {
    const router = new ToolRouter();
    router.register(echoTool());
    expect(router.toolNames()).toEqual(["echo"]);
  });
});

describe("ToolRouter I/O validation (Requirement 1.3)", () => {
  it("accepts well-formed input and returns validated output", async () => {
    const router = new ToolRouter();
    router.register(echoTool());
    const { output, replayed } = await router.invoke("echo", { value: "hi" });
    expect(output).toEqual({ value: "HI" });
    expect(replayed).toBe(false);
  });

  it("rejects malformed input with a validation error", async () => {
    const router = new ToolRouter();
    router.register(echoTool());
    await expect(router.invoke("echo", { value: 123 })).rejects.toBeInstanceOf(ToolValidationError);
    await expect(router.invoke("echo", { value: "" })).rejects.toBeInstanceOf(ToolValidationError);
    await expect(router.invoke("echo", { unexpected: "x" })).rejects.toBeInstanceOf(ToolValidationError);
  });

  it("tags the validation phase on input errors", async () => {
    const router = new ToolRouter();
    router.register(echoTool());
    await expect(router.invoke("echo", {})).rejects.toMatchObject({ phase: "input", toolName: "echo" });
  });

  it("rejects malformed handler output with a validation error", async () => {
    const router = new ToolRouter();
    router.register({
      name: "badOutput",
      description: "Produces output that violates its own schema.",
      stateChanging: false,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ value: z.string() }).strict(),
      handler: async () => ({ value: 42 }) as unknown as { value: string },
    });
    await expect(router.invoke("badOutput", {})).rejects.toMatchObject({ phase: "output" });
  });

  it("throws when invoking an unregistered tool", async () => {
    const router = new ToolRouter();
    await expect(router.invoke("nope", {})).rejects.toBeInstanceOf(ToolRegistrationError);
  });
});

describe("ToolRouter idempotency (Requirement 1.5)", () => {
  it("returns the stored result on replay without re-running side effects", async () => {
    const counter = { calls: 0 };
    const router = new ToolRouter();
    router.register(countingTool(counter));

    const first = await router.invoke("mutate", { payload: "a", idempotencyKey: "key-1" });
    expect(first.output).toEqual({ callOrdinal: 1 });
    expect(first.replayed).toBe(false);
    expect(counter.calls).toBe(1);

    const replay = await router.invoke("mutate", { payload: "a", idempotencyKey: "key-1" });
    expect(replay.output).toEqual({ callOrdinal: 1 });
    expect(replay.replayed).toBe(true);
    // The handler did not run again: no duplicate side effect.
    expect(counter.calls).toBe(1);
  });

  it("returns the original result even when a replay sends a different payload", async () => {
    const counter = { calls: 0 };
    const router = new ToolRouter();
    router.register(countingTool(counter));

    await router.invoke("mutate", { payload: "a", idempotencyKey: "key-1" });
    const replay = await router.invoke("mutate", { payload: "DIFFERENT", idempotencyKey: "key-1" });
    expect(replay.output).toEqual({ callOrdinal: 1 });
    expect(counter.calls).toBe(1);
  });

  it("runs the handler again for a different idempotency key", async () => {
    const counter = { calls: 0 };
    const router = new ToolRouter();
    router.register(countingTool(counter));

    await router.invoke("mutate", { payload: "a", idempotencyKey: "key-1" });
    const second = await router.invoke("mutate", { payload: "a", idempotencyKey: "key-2" });
    expect(second.output).toEqual({ callOrdinal: 2 });
    expect(second.replayed).toBe(false);
    expect(counter.calls).toBe(2);
  });

  it("runs the handler every time when no idempotency key is supplied", async () => {
    const counter = { calls: 0 };
    const router = new ToolRouter();
    router.register(countingTool(counter));

    await router.invoke("mutate", { payload: "a" });
    await router.invoke("mutate", { payload: "a" });
    expect(counter.calls).toBe(2);
  });

  it("scopes idempotency keys per tool", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.put("toolA", "shared", { from: "A" });
    const other = await store.get("toolB", "shared");
    expect(other).toBeUndefined();
  });

  it("does not consult the idempotency store for read-only tools", async () => {
    const router = new ToolRouter();
    router.register(echoTool());
    // A read-only tool ignores idempotencyKey entirely; strict schema rejects it.
    await expect(
      router.invoke("echo", { value: "hi", idempotencyKey: "key-1" }),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});
