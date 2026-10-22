/**
 * Entry point for the AI Transformation Validator MCP server.
 *
 * This bootstrap wires up the MCP server instance together with the discrete
 * tool router (Requirement 1.4), its Zod I/O validation (Requirement 1.3), and
 * the idempotency layer for state-changing tools (Requirement 1.5). The
 * individual tool handlers are thin stubs here; their real behaviour arrives in
 * later tasks without changing this registration plumbing.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, ToolRouter } from "./toolRouter.js";
import { registerWorkflowTools } from "./tools.js";

export const SERVER_NAME = "transformation-validator";
export const SERVER_VERSION = "0.1.0";

/**
 * Build a {@link ToolRouter} with every discrete workflow tool registered.
 * Exposed separately so the router can be exercised in-process by tests and by
 * later tasks without a live MCP transport.
 */
export function createToolRouter(): ToolRouter {
  const router = new ToolRouter();
  registerWorkflowTools(router);
  return router;
}

/**
 * Construct the MCP server instance for the Transformation Validator with all
 * discrete workflow tools registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerTools(server, createToolRouter());
  return server;
}

/**
 * Start the server over stdio. Invoked when this module is run directly.
 */
export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-start when executed as the process entry point, not when imported
// by tests or other modules.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error("Fatal error starting transformation-validator MCP server:", error);
    process.exitCode = 1;
  });
}
