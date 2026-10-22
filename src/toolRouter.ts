/**
 * Discrete MCP tool router with Zod I/O validation and an idempotency layer
 * (Requirements 1.3, 1.4, 1.5).
 *
 * Each workflow capability is registered as its own {@link ToolDefinition} and
 * surfaced as a discrete MCP tool (Requirement 1.4). Every invocation validates
 * the input against the tool's Zod input schema and the handler output against
 * its Zod output schema, rejecting malformed I/O (Requirement 1.3). State-
 * changing tools accept an `idempotencyKey`; when a key has already been seen
 * the stored result is returned without re-running the handler, so side effects
 * never repeat (Requirement 1.5).
 *
 * The router is intentionally decoupled from the MCP transport so its
 * validation and idempotency behaviour is unit-testable in isolation.
 * {@link registerTools} adapts a router onto an `McpServer`.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryIdempotencyStore, type IdempotencyStore } from "./idempotencyStore.js";

/**
 * The reserved field name that carries the idempotency key on a state-changing
 * tool's input. State-changing tool input schemas must include it.
 */
export const IDEMPOTENCY_KEY_FIELD = "idempotencyKey" as const;

/** Zod schema for the optional idempotency key shared by state-changing tools. */
export const idempotencyKeySchema = z
  .string()
  .min(1, "idempotencyKey must be a non-empty string")
  .optional();

/**
 * A single discrete tool. `TInput`/`TOutput` are inferred from the Zod schemas.
 *
 * `inputSchema` and `outputSchema` are Zod object schemas so their raw shapes
 * can be handed to the MCP SDK for discovery while the router performs the
 * authoritative validation.
 */
export interface ToolDefinition<
  TInputShape extends z.ZodRawShape = z.ZodRawShape,
  TOutputShape extends z.ZodRawShape = z.ZodRawShape,
> {
  /** Unique, discrete tool name (e.g. `analyze_project`). */
  readonly name: string;
  /** Human-readable description surfaced to MCP clients. */
  readonly description: string;
  /**
   * Whether the tool mutates persisted state. State-changing tools participate
   * in the idempotency layer and MUST declare an `idempotencyKey` field on
   * their input schema (Requirement 1.5).
   */
  readonly stateChanging: boolean;
  /** Zod object schema validating tool input (Requirement 1.3). */
  readonly inputSchema: z.ZodObject<TInputShape>;
  /** Zod object schema validating handler output (Requirement 1.3). */
  readonly outputSchema: z.ZodObject<TOutputShape>;
  /** The business logic. Receives validated input, returns to-be-validated output. */
  readonly handler: (input: z.infer<z.ZodObject<TInputShape>>) => Promise<z.infer<z.ZodObject<TOutputShape>>>;
}

/** Error thrown when a tool's input or output fails Zod validation. */
export class ToolValidationError extends Error {
  constructor(
    readonly toolName: string,
    readonly phase: "input" | "output",
    readonly issues: z.ZodError["issues"],
  ) {
    super(
      `Validation of ${phase} for tool "${toolName}" failed: ${issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "ToolValidationError";
  }
}

/** Error thrown when a tool definition is structurally invalid at registration. */
export class ToolRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRegistrationError";
  }
}

/** Outcome of a router invocation, flagging whether it was served from the idempotency store. */
export interface InvocationOutcome<TOutput> {
  readonly output: TOutput;
  /** True when the result was replayed from a stored idempotency record. */
  readonly replayed: boolean;
}

/**
 * Holds discrete tool definitions and executes them with validation and
 * idempotency. One router instance owns one idempotency store.
 */
export class ToolRouter {
  readonly #tools = new Map<string, ToolDefinition<z.ZodRawShape, z.ZodRawShape>>();
  readonly #idempotencyStore: IdempotencyStore;

  constructor(idempotencyStore: IdempotencyStore = new InMemoryIdempotencyStore()) {
    this.#idempotencyStore = idempotencyStore;
  }

  /** Register a discrete tool. Throws if the name is a duplicate or the definition is malformed. */
  register<TInputShape extends z.ZodRawShape, TOutputShape extends z.ZodRawShape>(
    definition: ToolDefinition<TInputShape, TOutputShape>,
  ): void {
    if (this.#tools.has(definition.name)) {
      throw new ToolRegistrationError(`Tool "${definition.name}" is already registered`);
    }
    if (definition.stateChanging && !(IDEMPOTENCY_KEY_FIELD in definition.inputSchema.shape)) {
      throw new ToolRegistrationError(
        `State-changing tool "${definition.name}" must declare an "${IDEMPOTENCY_KEY_FIELD}" field on its input schema`,
      );
    }
    this.#tools.set(definition.name, definition as unknown as ToolDefinition<z.ZodRawShape, z.ZodRawShape>);
  }

  /** The discrete tool names currently registered (Requirement 1.4). */
  toolNames(): string[] {
    return [...this.#tools.keys()];
  }

  /** Look up a registered tool definition by name. */
  getTool(name: string): ToolDefinition<z.ZodRawShape, z.ZodRawShape> | undefined {
    return this.#tools.get(name);
  }

  /**
   * Invoke a registered tool by name with raw (untrusted) input.
   *
   * 1. Validate input against the tool's input schema; reject malformed input.
   * 2. For a state-changing tool with a previously-seen `idempotencyKey`,
   *    return the stored result without running the handler.
   * 3. Otherwise run the handler, validate its output, and — for a state-
   *    changing tool with a key — record the result before returning.
   */
  async invoke(name: string, rawInput: unknown): Promise<InvocationOutcome<unknown>> {
    const tool = this.#tools.get(name);
    if (!tool) {
      throw new ToolRegistrationError(`No tool registered under name "${name}"`);
    }

    const parsedInput = tool.inputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      throw new ToolValidationError(name, "input", parsedInput.error.issues);
    }
    const input = parsedInput.data as Record<string, unknown>;

    const idempotencyKey =
      tool.stateChanging && typeof input[IDEMPOTENCY_KEY_FIELD] === "string"
        ? (input[IDEMPOTENCY_KEY_FIELD] as string)
        : undefined;

    if (idempotencyKey !== undefined) {
      const existing = await this.#idempotencyStore.get(name, idempotencyKey);
      if (existing) {
        // Replay: return the stored result; the handler (and its side effects)
        // is deliberately NOT invoked again (Requirement 1.5).
        return { output: existing.result, replayed: true };
      }
    }

    const handlerResult = await tool.handler(input as never);

    const parsedOutput = tool.outputSchema.safeParse(handlerResult);
    if (!parsedOutput.success) {
      throw new ToolValidationError(name, "output", parsedOutput.error.issues);
    }
    const output = parsedOutput.data;

    if (idempotencyKey !== undefined) {
      const stored = await this.#idempotencyStore.put(name, idempotencyKey, output);
      // Honour any pre-existing record from a concurrent first-write.
      return { output: stored.result, replayed: false };
    }

    return { output, replayed: false };
  }
}

/** Shape of a tool's structured result as returned to MCP clients. */
interface ToolCallResult {
  [key: string]: unknown;
  structuredContent: Record<string, unknown>;
  content: { type: "text"; text: string }[];
}

/**
 * Register every tool held by a {@link ToolRouter} onto an `McpServer` as a
 * discrete MCP tool (Requirement 1.4). The SDK-level call is routed back
 * through {@link ToolRouter.invoke} so validation and idempotency apply
 * uniformly whether a tool is called over MCP or in-process.
 */
export function registerTools(server: McpServer, router: ToolRouter): void {
  for (const name of router.toolNames()) {
    const tool = router.getTool(name);
    if (!tool) {
      continue;
    }
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema.shape,
        outputSchema: tool.outputSchema.shape,
        annotations: {
          readOnlyHint: !tool.stateChanging,
        },
      },
      async (args: unknown): Promise<ToolCallResult> => {
        const { output } = await router.invoke(tool.name, args);
        const structured = output as Record<string, unknown>;
        return {
          structuredContent: structured,
          content: [{ type: "text", text: JSON.stringify(structured) }],
        };
      },
    );
  }
}
