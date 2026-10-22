import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { z } from "zod";
import { idempotencyKeySchema, ToolRouter, type ToolDefinition } from "./toolRouter.js";
import { InMemoryIdempotencyStore } from "./idempotencyStore.js";

/**
 * Property 1: Idempotency of state-changing operations.
 *
 * Feature: ai-transformation-validator, Property 1: Idempotency of
 * state-changing operations.
 *
 * Validates: Requirements 1.5 — WHERE an operation changes persisted state, THE
 * MCP_Server SHALL accept an Idempotency_Key and SHALL return the original
 * result when the same Idempotency_Key is replayed.
 *
 * The property exercises the real {@link ToolRouter} and
 * {@link InMemoryIdempotencyStore} against a state-changing tool whose handler
 * bumps a side-effect counter and returns the counter value. For any sequence
 * of keyed invocations, replaying a previously-seen idempotency key must:
 *   1. return the exact result recorded for that key's first invocation, and
 *   2. leave the side-effect counter unchanged (no duplicate side effect).
 */

/**
 * A state-changing tool whose handler increments the supplied counter on every
 * real execution. The returned `callOrdinal`/`token` double as the observable
 * "result" and the observable "side effect": a replay must reproduce the
 * recorded result and must NOT advance the counter.
 */
function countingTool(counter: { calls: number }): ToolDefinition<z.ZodRawShape, z.ZodRawShape> {
  return {
    name: "mutate",
    description: "Mutate state and report the call ordinal.",
    stateChanging: true,
    inputSchema: z.object({ payload: z.string().min(1), idempotencyKey: idempotencyKeySchema }).strict(),
    outputSchema: z.object({ callOrdinal: z.number().int(), token: z.string() }).strict(),
    handler: async () => {
      counter.calls += 1;
      return { callOrdinal: counter.calls, token: `token-${counter.calls}` };
    },
  };
}

describe("Property 1: Idempotency of state-changing operations (Requirement 1.5)", () => {
  it("replaying a key returns the original result and produces no duplicate side effect", async () => {
    // A generated invocation: a non-empty idempotency key and an arbitrary payload.
    const invocationArb = fc.record({
      key: fc.string({ minLength: 1, maxLength: 12 }),
      payload: fc.string({ minLength: 1, maxLength: 12 }),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(invocationArb, { minLength: 1, maxLength: 30 }), async (invocations) => {
        const counter = { calls: 0 };
        const router = new ToolRouter(new InMemoryIdempotencyStore());
        router.register(countingTool(counter));

        // The first result recorded for each distinct key.
        const firstResultByKey = new Map<string, { callOrdinal: number; token: string }>();

        for (const { key, payload } of invocations) {
          const callsBefore = counter.calls;
          const seenBefore = firstResultByKey.has(key);

          const { output, replayed } = await router.invoke("mutate", {
            payload,
            idempotencyKey: key,
          });
          const result = output as { callOrdinal: number; token: string };

          if (seenBefore) {
            // Replay: original result returned, flagged as replayed, and the
            // side-effect counter did NOT advance.
            expect(replayed).toBe(true);
            expect(result).toEqual(firstResultByKey.get(key));
            expect(counter.calls).toBe(callsBefore);
          } else {
            // First time for this key: the handler ran exactly once (one new
            // side effect) and its result becomes the recorded result.
            expect(replayed).toBe(false);
            expect(counter.calls).toBe(callsBefore + 1);
            firstResultByKey.set(key, result);
          }
        }

        // The number of real side effects equals the number of distinct keys:
        // no key ever triggered the handler more than once.
        expect(counter.calls).toBe(firstResultByKey.size);
      }),
      { numRuns: 100 },
    );
  });
});
