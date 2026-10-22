import { describe, expect, it } from "vitest";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

describe("transformation-validator server bootstrap", () => {
  it("exposes the expected server identity", () => {
    expect(SERVER_NAME).toBe("transformation-validator");
    expect(SERVER_VERSION).toBe("0.1.0");
  });

  it("constructs an MCP server instance", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});
