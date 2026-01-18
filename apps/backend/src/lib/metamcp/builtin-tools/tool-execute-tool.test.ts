/**
 * Tool Execute Tool Tests
 *
 * Comprehensive test suite for the execute tool including:
 * - Type guard validation
 * - AJV schema validation
 * - Error handling
 * - Tool lookup logic
 * - Error message formatting
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  TOOL_EXECUTE_TOOL_NAME,
  TOOL_EXECUTE_TOOL_DEFINITION,
  isToolExecuteArguments,
  executeToolExecution,
  type MetaMCPHandlerContext,
  type ToolWithServer,
} from "./tool-execute-tool.js";
import { TOOL_SEARCH_TOOL_NAME } from "./tool-search-tool.js";

describe("Tool Execute Tool", () => {
  describe("TOOL_EXECUTE_TOOL_DEFINITION", () => {
    it("should have correct tool name", () => {
      expect(TOOL_EXECUTE_TOOL_DEFINITION.name).toBe(TOOL_EXECUTE_TOOL_NAME);
    });

    it("should have required inputSchema fields", () => {
      expect(TOOL_EXECUTE_TOOL_DEFINITION.inputSchema).toBeDefined();
      expect(TOOL_EXECUTE_TOOL_DEFINITION.inputSchema?.required).toEqual([
        "tool_name",
        "arguments",
      ]);
    });

    it("should have tool_name as string property", () => {
      const schema = TOOL_EXECUTE_TOOL_DEFINITION.inputSchema;
      expect(schema?.properties?.tool_name).toEqual({
        type: "string",
        description: expect.any(String),
      });
    });

    it("should have arguments as object property", () => {
      const schema = TOOL_EXECUTE_TOOL_DEFINITION.inputSchema;
      expect(schema?.properties?.arguments).toEqual({
        type: "object",
        description: expect.any(String),
        additionalProperties: true,
      });
    });
  });

  describe("isToolExecuteArguments", () => {
    it("should validate correct arguments", () => {
      expect(
        isToolExecuteArguments({
          tool_name: "test__tool",
          arguments: { foo: "bar" },
        })
      ).toBe(true);
    });

    it("should validate arguments with empty object", () => {
      expect(
        isToolExecuteArguments({
          tool_name: "test__tool",
          arguments: {},
        })
      ).toBe(true);
    });

    it("should reject null", () => {
      expect(isToolExecuteArguments(null)).toBe(false);
    });

    it("should reject undefined", () => {
      expect(isToolExecuteArguments(undefined)).toBe(false);
    });

    it("should reject empty object", () => {
      expect(isToolExecuteArguments({})).toBe(false);
    });

    it("should reject missing tool_name", () => {
      expect(isToolExecuteArguments({ arguments: {} })).toBe(false);
    });

    it("should reject missing arguments", () => {
      expect(isToolExecuteArguments({ tool_name: "test" })).toBe(false);
    });

    it("should reject tool_name as number", () => {
      expect(isToolExecuteArguments({ tool_name: 123, arguments: {} })).toBe(
        false
      );
    });

    it("should reject arguments as string", () => {
      expect(
        isToolExecuteArguments({ tool_name: "test", arguments: "not an object" })
      ).toBe(false);
    });

    it("should reject arguments as null", () => {
      expect(isToolExecuteArguments({ tool_name: "test", arguments: null })).toBe(
        false
      );
    });
  });

  describe("executeToolExecution - Circular execution prevention", () => {
    const mockContext: MetaMCPHandlerContext = {
      namespaceUuid: "test-namespace",
      sessionId: "test-session",
    };

    it("should prevent executing metamcp_execute_tool", async () => {
      const result = await executeToolExecution(
        { tool_name: TOOL_EXECUTE_TOOL_NAME, arguments: {} },
        [],
        vi.fn(),
        mockContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("Cannot execute builtin tool"),
      });
      expect(result.content[0].text).toContain(TOOL_EXECUTE_TOOL_NAME);
    });

    it("should prevent executing metamcp_search_tools", async () => {
      const result = await executeToolExecution(
        { tool_name: TOOL_SEARCH_TOOL_NAME, arguments: {} },
        [],
        vi.fn(),
        mockContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("Cannot execute builtin tool"),
      });
      expect(result.content[0].text).toContain(TOOL_SEARCH_TOOL_NAME);
    });
  });

  describe("executeToolExecution - Tool lookup", () => {
    const mockContext: MetaMCPHandlerContext = {
      namespaceUuid: "test-namespace",
      sessionId: "test-session",
    };

    it("should find tool by exact name match", async () => {
      const tools: ToolWithServer[] = [
        {
          tool: { name: "filesystem__read_file", description: "Read a file" },
          serverUuid: "fs-server",
        },
        {
          tool: { name: "database__query", description: "Query database" },
          serverUuid: "db-server",
        },
      ];

      const mockProxy = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      await executeToolExecution(
        {
          tool_name: "database__query",
          arguments: {},
        },
        tools,
        mockProxy,
        mockContext
      );

      expect(mockProxy).toHaveBeenCalledWith("database__query", {});
    });

    it("should return error for unknown tool", async () => {
      const tools: ToolWithServer[] = [
        {
          tool: { name: "filesystem__read_file", description: "Read a file" },
          serverUuid: "fs-server",
        },
      ];

      const result = await executeToolExecution(
        { tool_name: "nonexistent", arguments: {} },
        tools,
        vi.fn(),
        mockContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
      expect(result.content[0].text).toContain("nonexistent");
    });

    it("should suggest available tools when not found", async () => {
      const tools: ToolWithServer[] = [
        {
          tool: { name: "filesystem__read_file", description: "Read a file" },
          serverUuid: "fs-server",
        },
        {
          tool: { name: "database__query", description: "Query database" },
          serverUuid: "db-server",
        },
      ];

      const result = await executeToolExecution(
        { tool_name: "nonexistent", arguments: {} },
        tools,
        vi.fn(),
        mockContext
      );

      expect(result.content[0].text).toContain("filesystem__read_file");
      expect(result.content[0].text).toContain("database__query");
      expect(result.content[0].text).toContain("metamcp_search_tools");
    });

    it("should limit displayed tools to 10", async () => {
      const tools: ToolWithServer[] = Array.from({ length: 20 }, (_, i) => ({
        tool: { name: `server__tool_${i}`, description: `Tool ${i}` },
        serverUuid: `server-${i}`,
      }));

      const result = await executeToolExecution(
        { tool_name: "nonexistent", arguments: {} },
        tools,
        vi.fn(),
        mockContext
      );

      const text = result.content[0].text;
      expect(text).toContain("and 10 more tools");
    });
  });

  describe("executeToolExecution - Schema validation", () => {
    const mockContext: MetaMCPHandlerContext = {
      namespaceUuid: "test-namespace",
      sessionId: "test-session",
    };

    const createTool = (schema: any): ToolWithServer => ({
      tool: {
        name: "test__tool",
        description: "Test tool",
        inputSchema: schema,
      },
      serverUuid: "test-server",
    });

    it("should validate arguments matching schema", async () => {
      const tool = createTool({
        type: "object",
        properties: {
          path: { type: "string" },
          count: { type: "number" },
        },
        required: ["path"],
      });

      const mockProxy = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      const result = await executeToolExecution(
        {
          tool_name: "test__tool",
          arguments: { path: "/test.txt", count: 5 },
        },
        [tool],
        mockProxy,
        mockContext
      );

      expect(result.isError).toBeUndefined();
      expect(mockProxy).toHaveBeenCalledWith("test__tool", {
        path: "/test.txt",
        count: 5,
      });
    });

    it("should reject invalid type", async () => {
      const tool = createTool({
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"],
      });

      const result = await executeToolExecution(
        { tool_name: "test__tool", arguments: { count: "not a number" } },
        [tool],
        vi.fn(),
        mockContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("validation failed");
    });

    it("should reject missing required field", async () => {
      const tool = createTool({
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      });

      const result = await executeToolExecution(
        { tool_name: "test__tool", arguments: {} },
        [tool],
        vi.fn(),
        mockContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("validation failed");
      expect(result.content[0].text).toContain("required");
    });

    it("should accept tool without inputSchema", async () => {
      const tool: ToolWithServer = {
        tool: {
          name: "test__tool",
          description: "Test tool",
        },
        serverUuid: "test-server",
      };

      const mockProxy = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      const result = await executeToolExecution(
        { tool_name: "test__tool", arguments: { anything: "goes" } },
        [tool],
        mockProxy,
        mockContext
      );

      expect(result.isError).toBeUndefined();
      expect(mockProxy).toHaveBeenCalledWith("test__tool", { anything: "goes" });
    });

    it("should handle tool with invalid schema gracefully", async () => {
      const tool: ToolWithServer = {
        tool: {
          name: "test__tool",
          description: "Test tool",
          inputSchema: { type: "invalid_type" } as any,
        },
        serverUuid: "test-server",
      };

      const result = await executeToolExecution(
        { tool_name: "test__tool", arguments: {} },
        [tool],
        vi.fn(),
        mockContext
      );

      // Should fail validation but not crash
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("validation failed");
    });

    it("should validate enum values", async () => {
      const tool = createTool({
        type: "object",
        properties: {
          mode: { type: "string", enum: ["read", "write"] },
        },
        required: ["mode"],
      });

      // Valid enum value
      const mockProxy = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      const validResult = await executeToolExecution(
        { tool_name: "test__tool", arguments: { mode: "read" } },
        [tool],
        mockProxy,
        mockContext
      );

      expect(validResult.isError).toBeUndefined();

      // Invalid enum value
      const invalidResult = await executeToolExecution(
        { tool_name: "test__tool", arguments: { mode: "invalid" } },
        [tool],
        vi.fn(),
        mockContext
      );

      expect(invalidResult.isError).toBe(true);
      expect(invalidResult.content[0].text).toContain("validation failed");
    });

    it("should validate array types", async () => {
      const tool = createTool({
        type: "object",
        properties: {
          items: { type: "array", items: { type: "string" } },
        },
        required: ["items"],
      });

      // Valid array
      const mockProxy = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      const validResult = await executeToolExecution(
        { tool_name: "test__tool", arguments: { items: ["a", "b", "c"] } },
        [tool],
        mockProxy,
        mockContext
      );

      expect(validResult.isError).toBeUndefined();

      // Invalid: items is not an array
      const invalidResult = await executeToolExecution(
        { tool_name: "test__tool", arguments: { items: "not an array" } },
        [tool],
        vi.fn(),
        mockContext
      );

      expect(invalidResult.isError).toBe(true);
    });
  });

  describe("executeToolExecution - Error formatting", () => {
    const mockContext: MetaMCPHandlerContext = {
      namespaceUuid: "test-namespace",
      sessionId: "test-session",
    };

    it("should format validation errors with schema", async () => {
      const tool: ToolWithServer = {
        tool: {
          name: "test__tool",
          description: "Test tool",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path" },
              mode: { type: "string", enum: ["read", "write"] },
            },
            required: ["path", "mode"],
          },
        },
        serverUuid: "test-server",
      };

      const result = await executeToolExecution(
        { tool_name: "test__tool", arguments: { path: 123, mode: "invalid" } },
        [tool],
        vi.fn(),
        mockContext
      );

      expect(result.isError).toBe(true);
      const errorText = result.content[0].text;

      // Should include validation errors
      expect(errorText).toContain("validation failed");

      // Should include expected schema
      expect(errorText).toContain("Expected schema:");
      expect(errorText).toContain('"type": "string"');
    });

    it("should limit displayed errors to 10", async () => {
      // Create schema with 15 required fields
      const properties: any = {};
      const required = [];
      for (let i = 0; i < 15; i++) {
        properties[`field${i}`] = { type: "string" };
        required.push(`field${i}`);
      }

      const tool: ToolWithServer = {
        tool: {
          name: "test__tool",
          description: "Test tool",
          inputSchema: { type: "object", properties, required },
        },
        serverUuid: "test-server",
      };

      const result = await executeToolExecution(
        { tool_name: "test__tool", arguments: {} }, // Missing all required fields
        [tool],
        vi.fn(),
        mockContext
      );

      const errorText = result.content[0].text;
      expect(errorText).toContain("and 5 more errors");
    });
  });

  describe("executeToolExecution - Proxy execution", () => {
    const mockContext: MetaMCPHandlerContext = {
      namespaceUuid: "test-namespace",
      sessionId: "test-session",
    };

    it("should proxy successful execution", async () => {
      const tool: ToolWithServer = {
        tool: {
          name: "test__tool",
          description: "Test tool",
          inputSchema: {
            type: "object",
            properties: { input: { type: "string" } },
            required: ["input"],
          },
        },
        serverUuid: "test-server",
      };

      const mockResponse = {
        content: [{ type: "text" as const, text: "Tool output" }],
      };

      const mockProxy = vi.fn().mockResolvedValue(mockResponse);

      const result = await executeToolExecution(
        { tool_name: "test__tool", arguments: { input: "test" } },
        [tool],
        mockProxy,
        mockContext
      );

      // Should produce same result as direct call
      expect(result).toEqual(mockResponse);
      expect(mockProxy).toHaveBeenCalledWith("test__tool", { input: "test" });
    });

    it("should handle proxy execution errors", async () => {
      const tool: ToolWithServer = {
        tool: {
          name: "test__tool",
          description: "Test tool",
        },
        serverUuid: "test-server",
      };

      const mockProxy = vi
        .fn()
        .mockRejectedValue(new Error("Connection timeout"));

      const result = await executeToolExecution(
        { tool_name: "test__tool", arguments: {} },
        [tool],
        mockProxy,
        mockContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error executing tool");
      expect(result.content[0].text).toContain("Connection timeout");
    });

    it("should handle non-Error proxy exceptions", async () => {
      const tool: ToolWithServer = {
        tool: {
          name: "test__tool",
          description: "Test tool",
        },
        serverUuid: "test-server",
      };

      const mockProxy = vi.fn().mockRejectedValue("String error");

      const result = await executeToolExecution(
        { tool_name: "test__tool", arguments: {} },
        [tool],
        mockProxy,
        mockContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error executing tool");
      expect(result.content[0].text).toContain("String error");
    });
  });
});
