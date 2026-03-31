/**
 * MCP (Model Context Protocol) client — basic types and placeholder.
 * Full protocol implementation is future work.
 */

export interface McpServerConfig {
  name: string;
  command: string[];
  env?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpClient {
  constructor(public readonly config: McpServerConfig) {}

  async connect(): Promise<void> {
    // TODO: implement stdio transport
  }

  async listTools(): Promise<McpTool[]> {
    return [];
  }

  async callTool(
    name: string,
    _args: Record<string, unknown>,
  ): Promise<unknown> {
    throw new Error(`MCP not yet implemented: ${name}`);
  }

  async disconnect(): Promise<void> {
    // TODO: cleanup
  }
}
