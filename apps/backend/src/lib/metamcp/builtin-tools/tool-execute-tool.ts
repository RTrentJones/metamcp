/**
 * Tool Execute Tool - Built-in MCP Tool
 *
 * Enables universal MCP client compatibility by providing a validated execution
 * wrapper for tools discovered via metamcp_search_tools. This allows clients
 * without tool_reference support (like Cline, VS Code Copilot) to use defer-loading.
 *
 * The tool validates arguments against JSON Schema before proxying to upstream servers.
 */

import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import Ajv, { type ErrorObject } from "ajv";
import { TOOL_SEARCH_TOOL_NAME } from "./tool-search-tool.js";

/**
 * Tool name for the execute tool
 */
export const TOOL_EXECUTE_TOOL_NAME = "metamcp_execute_tool";

/**
 * Tool definition following MCP Tool schema
 */
export const TOOL_EXECUTE_TOOL_DEFINITION: Tool = {
  name: TOOL_EXECUTE_TOOL_NAME,
  description:
    "Execute any available tool by name. Use this when you've discovered tools via search " +
    "and want to invoke them. Requires the full tool name (e.g., 'filesystem__read_file') " +
    "and arguments matching the tool's input schema. Arguments are validated before execution.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: {
        type: "string",
        description:
          "Full name of the tool to execute (e.g., 'filesystem__read_file')",
      },
      arguments: {
        type: "object",
        description:
          "Arguments to pass to the tool, matching its input schema",
        additionalProperties: true,
      },
    },
    required: ["tool_name", "arguments"],
  },
};

/**
 * Tool execute arguments schema
 */
export interface ToolExecuteArguments {
  tool_name: string;
  arguments: Record<string, unknown>;
}

/**
 * Type guard to validate unknown arguments match ToolExecuteArguments
 *
 * @param args - Unknown arguments from MCP request
 * @returns True if args has the shape of ToolExecuteArguments
 */
export function isToolExecuteArguments(
  args: unknown
): args is ToolExecuteArguments {
  return (
    args !== null &&
    typeof args === "object" &&
    "tool_name" in args &&
    typeof (args as any).tool_name === "string" &&
    "arguments" in args &&
    typeof (args as any).arguments === "object" &&
    (args as any).arguments !== null
  );
}

/**
 * Context for execute tool handler
 */
export interface MetaMCPHandlerContext {
  namespaceUuid: string;
  sessionId: string;
}

/**
 * Tool with server UUID mapping
 */
export interface ToolWithServer {
  tool: Tool;
  serverUuid: string;
}

/**
 * Validate tool arguments against JSON Schema using AJV
 *
 * @param tool - Tool with inputSchema
 * @param args - Arguments to validate
 * @returns Validation result with errors if invalid
 */
async function validateToolArguments(
  tool: Tool,
  args: unknown
): Promise<{ valid: boolean; errors?: ErrorObject[] }> {
  const ajv = new Ajv({
    allErrors: true,
    strict: false, // Allow unknown keywords in MCP schemas
  });

  // Default schema if tool doesn't provide one
  const schema = tool.inputSchema || {
    type: "object",
    properties: {},
    additionalProperties: true,
  };

  try {
    const validate = ajv.compile(schema);
    const valid = validate(args);

    return {
      valid: valid === true,
      errors: validate.errors || [],
    };
  } catch (err) {
    // Invalid schema itself
    return {
      valid: false,
      errors: [
        {
          instancePath: "",
          schemaPath: "",
          keyword: "schema",
          params: {},
          message: `Invalid tool schema: ${err instanceof Error ? err.message : String(err)}`,
        } as ErrorObject,
      ],
    };
  }
}

/**
 * Format validation errors into a helpful error message
 *
 * @param errors - AJV validation errors
 * @param tool - Tool being validated
 * @returns Formatted error message with schema
 */
function formatValidationErrors(errors: ErrorObject[], tool: Tool): string {
  const maxErrors = 10;
  const displayErrors = errors.slice(0, maxErrors);
  const remaining = errors.length - maxErrors;

  const errorMessages = displayErrors
    .map((err) => `  - ${err.instancePath || "(root)"}: ${err.message}`)
    .join("\n");

  const moreErrors = remaining > 0 ? `\n  ... and ${remaining} more errors` : "";

  return (
    `Tool "${tool.name}" validation failed:\n\n${errorMessages}${moreErrors}\n\n` +
    `Expected schema:\n\`\`\`json\n${JSON.stringify(tool.inputSchema, null, 2)}\n\`\`\``
  );
}

/**
 * Execute a tool by name with validation
 *
 * This is the main entry point for the execute tool. It:
 * 1. Prevents circular execution of builtin tools
 * 2. Finds the target tool by name
 * 3. Validates arguments against the tool's schema
 * 4. Proxies execution to the upstream server
 *
 * @param args - Tool execution arguments
 * @param availableTools - List of available tools with server UUIDs
 * @param proxyFunction - Function to proxy tool execution (respects middleware)
 * @param context - Handler context
 * @returns Tool execution result or error
 */
export async function executeToolExecution(
  args: ToolExecuteArguments,
  availableTools: ToolWithServer[],
  proxyFunction: (toolName: string, args: unknown) => Promise<CallToolResult>,
  context: MetaMCPHandlerContext
): Promise<CallToolResult> {
  // 1. Prevent circular execution of builtin tools
  if (
    args.tool_name === TOOL_EXECUTE_TOOL_NAME ||
    args.tool_name === TOOL_SEARCH_TOOL_NAME
  ) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: Cannot execute builtin tool "${args.tool_name}" via metamcp_execute_tool`,
        },
      ],
      isError: true,
    };
  }

  // 2. Find target tool
  const targetTool = availableTools.find((t) => t.tool.name === args.tool_name);

  if (!targetTool) {
    // Suggest available tools (limit to 10 for readability)
    const toolList = availableTools
      .slice(0, 10)
      .map((t) => `  - ${t.tool.name}`)
      .join("\n");

    const moreTools =
      availableTools.length > 10
        ? `\n  ... and ${availableTools.length - 10} more tools`
        : "";

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Error: Tool "${args.tool_name}" not found.\n\n` +
            `Available tools:\n${toolList}${moreTools}\n\n` +
            `Use metamcp_search_tools to discover tools.`,
        },
      ],
      isError: true,
    };
  }

  // 3. Validate arguments against schema
  const validationResult = await validateToolArguments(
    targetTool.tool,
    args.arguments
  );

  if (!validationResult.valid) {
    return {
      content: [
        {
          type: "text" as const,
          text: formatValidationErrors(
            validationResult.errors || [],
            targetTool.tool
          ),
        },
      ],
      isError: true,
    };
  }

  // 4. Proxy execution (respects all middleware)
  try {
    return await proxyFunction(args.tool_name, args.arguments);
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error executing tool "${args.tool_name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
}
