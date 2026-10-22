import { describe, expect, it } from "vitest";
import { ToolRouter } from "./toolRouter.js";
import { registerWorkflowTools, workflowToolDefinitions } from "./tools.js";
import { createServer, createToolRouter } from "./server.js";

const EXPECTED_TOOLS = [
  "analyze_project",
  "discover_test_assets",
  "propose_uat",
  "validate_uat_contract",
  "freeze_uat_contract",
  "detect_runtime",
  "generate_runtime_contract",
  "validate_runtime_contract",
  "create_validation_run",
  "provision_microvm",
  "prepare_fixture",
  "execute_validation",
  "collect_evidence",
  "finalize_baseline",
  "prepare_transformed_run",
  "compare_runs",
  "generate_confidence_matrix",
  "get_run_status",
  "resume_run",
  "destroy_environment",
];

// From the design's MCP Tool Surface table.
const READ_ONLY_TOOLS = new Set([
  "analyze_project",
  "discover_test_assets",
  "validate_uat_contract",
  "detect_runtime",
  "get_run_status",
]);

describe("workflow tool surface (Requirement 1.4)", () => {
  it("registers every discrete workflow tool", () => {
    const router = new ToolRouter();
    registerWorkflowTools(router);
    expect(router.toolNames().sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("marks exactly the read-only tools as non-state-changing", () => {
    for (const definition of workflowToolDefinitions) {
      expect(definition.stateChanging).toBe(!READ_ONLY_TOOLS.has(definition.name));
    }
  });

  it("requires an idempotencyKey field on every state-changing tool", () => {
    for (const definition of workflowToolDefinitions) {
      if (definition.stateChanging) {
        expect("idempotencyKey" in definition.inputSchema.shape).toBe(true);
      }
    }
  });
});

describe("workflow tool behaviour through the router", () => {
  it("validates input and returns a stub result for a read-only tool", async () => {
    const router = createToolRouter();
    const { output } = await router.invoke("analyze_project", { projectPath: "/tmp/app" });
    expect(output).toMatchObject({ tool: "analyze_project", status: "not_implemented" });
  });

  it("replays a state-changing tool result without re-running the handler", async () => {
    const router = createToolRouter();
    const first = await router.invoke("provision_microvm", {
      runId: "run-1",
      target: "baseline",
      idempotencyKey: "idem-1",
    });
    const replay = await router.invoke("provision_microvm", {
      runId: "run-1",
      target: "baseline",
      idempotencyKey: "idem-1",
    });
    expect(replay.replayed).toBe(true);
    expect(replay.output).toEqual(first.output);
  });
});

describe("MCP server wiring", () => {
  it("constructs a server with the tools registered", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});
