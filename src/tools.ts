/**
 * Discrete workflow tool definitions for the AI Transformation Validator
 * (Requirement 1.4). Each entry in the design's MCP Tool Surface is registered
 * here as its own tool with a Zod-validated input/output contract.
 *
 * The handlers are thin stubs: this task establishes the discrete-operation
 * structure plus the router's validation and idempotency plumbing. Real
 * behaviour for each tool arrives in later tasks, which will replace the stub
 * handlers and enrich the schemas without changing the registration mechanism.
 */
import { z } from "zod";
import { idempotencyKeySchema, type ToolDefinition, type ToolRouter } from "./toolRouter.js";

/**
 * Minimal stub output every placeholder handler returns: it echoes the tool
 * name and marks the result as not-yet-implemented so callers (and tests) can
 * tell a stub apart from a real result.
 */
const stubOutputSchema = z
  .object({
    tool: z.string(),
    status: z.literal("not_implemented"),
    received: z.record(z.string(), z.unknown()),
  })
  .strict();

/** A placeholder handler that echoes its validated input. */
function stubHandler(toolName: string) {
  return async (input: Record<string, unknown>): Promise<z.infer<typeof stubOutputSchema>> => {
    return { tool: toolName, status: "not_implemented", received: input };
  };
}

/**
 * Build a non-state-changing tool definition with a stub handler. The specific
 * input shape is erased to the router's generic `ToolDefinition` type so the
 * definitions can be collected in a single homogeneous array; the stub handler
 * only ever reads the already-validated input generically.
 */
function readOnlyStub(
  name: string,
  description: string,
  inputShape: z.ZodRawShape,
): ToolDefinition<z.ZodRawShape, z.ZodRawShape> {
  return {
    name,
    description,
    stateChanging: false,
    inputSchema: z.object(inputShape).strict(),
    outputSchema: stubOutputSchema,
    handler: stubHandler(name),
  };
}

/** Build a state-changing tool definition with an `idempotencyKey` field and a stub handler. */
function stateChangingStub(
  name: string,
  description: string,
  inputShape: z.ZodRawShape,
): ToolDefinition<z.ZodRawShape, z.ZodRawShape> {
  const shape = { ...inputShape, idempotencyKey: idempotencyKeySchema };
  return {
    name,
    description,
    stateChanging: true,
    inputSchema: z.object(shape).strict(),
    outputSchema: stubOutputSchema,
    handler: stubHandler(name),
  };
}

/**
 * The full discrete tool surface from the design. Each definition is a
 * standalone operation (Requirement 1.4); state-changing tools (`stateChanging:
 * true`) carry an `idempotencyKey` and are idempotent on replay (Requirement
 * 1.5).
 */
export const workflowToolDefinitions: ToolDefinition<z.ZodRawShape, z.ZodRawShape>[] = [
  readOnlyStub("analyze_project", "Inspect a repository and emit detected apps, runtimes, interfaces, and assumptions.", {
    projectPath: z.string().min(1),
  }),
  readOnlyStub("discover_test_assets", "Find existing UAT, docs, tests, and API specs in the project.", {
    projectId: z.string().min(1),
  }),
  stateChangingStub("propose_uat", "Generate a proposed UAT contract (DRAFT) plus coverage gaps.", {
    projectId: z.string().min(1),
  }),
  readOnlyStub("validate_uat_contract", "Validate a UAT contract structurally.", {
    contractId: z.string().min(1),
  }),
  stateChangingStub("freeze_uat_contract", "Approve and lock an exact UAT version, recording its content hash.", {
    contractId: z.string().min(1),
    version: z.number().int().nonnegative(),
  }),
  readOnlyStub("detect_runtime", "Run runtime adapter detection with confidence and evidence.", {
    projectId: z.string().min(1),
  }),
  stateChangingStub("generate_runtime_contract", "Produce a Runtime contract draft from adapter output.", {
    projectId: z.string().min(1),
    target: z.enum(["legacy", "transformed"]),
  }),
  stateChangingStub("validate_runtime_contract", "Approve a Runtime contract version.", {
    contractId: z.string().min(1),
    version: z.number().int().nonnegative(),
  }),
  stateChangingStub("create_validation_run", "Create a tracked, resumable validation run.", {
    projectId: z.string().min(1),
    uatVersion: z.number().int().nonnegative(),
  }),
  stateChangingStub("provision_microvm", "Provision a dedicated, isolated MicroVM in the customer account.", {
    runId: z.string().min(1),
    target: z.enum(["baseline", "transformed"]),
  }),
  stateChangingStub("prepare_fixture", "Restore deterministic fixture state and inject runtime secrets.", {
    runId: z.string().min(1),
  }),
  stateChangingStub("execute_validation", "Build, start, health-check, and run the approved contract.", {
    runId: z.string().min(1),
  }),
  stateChangingStub("collect_evidence", "Capture and upload normalized evidence by reference.", {
    runId: z.string().min(1),
  }),
  stateChangingStub("finalize_baseline", "Produce and lock the Baseline manifest.", {
    runId: z.string().min(1),
  }),
  stateChangingStub("prepare_transformed_run", "Provision a new clean MicroVM with equivalent fixtures and replay.", {
    runId: z.string().min(1),
  }),
  stateChangingStub("compare_runs", "Verify manifest hashes and perform the three-way classification.", {
    runId: z.string().min(1),
  }),
  stateChangingStub("generate_confidence_matrix", "Compute the weighted confidence matrix and gate.", {
    runId: z.string().min(1),
  }),
  readOnlyStub("get_run_status", "Return the current persisted state of a validation run.", {
    runId: z.string().min(1),
  }),
  stateChangingStub("resume_run", "Resume an interrupted run from persisted state.", {
    runId: z.string().min(1),
  }),
  stateChangingStub("destroy_environment", "Terminate the MicroVM, release resources, and record cleanup.", {
    runId: z.string().min(1),
  }),
];

/** Register every discrete workflow tool onto the given router. */
export function registerWorkflowTools(router: ToolRouter): void {
  for (const definition of workflowToolDefinitions) {
    router.register(definition);
  }
}
