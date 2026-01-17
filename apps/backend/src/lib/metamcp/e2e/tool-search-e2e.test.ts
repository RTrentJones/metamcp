/**
 * Tool Search E2E Tests
 *
 * These tests verify the end-to-end behavior of the tool search feature:
 * 1. defer_loading flag is correctly returned (Anthropic's advanced tool use)
 * 2. When configured, only the search tool is directly accessible (other tools are deferred)
 * 3. A model can invoke the search tool, find tools, and then invoke them
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// Mock the database repositories before any imports that might use them
vi.mock("../../../db/repositories/index.js", () => ({
  namespacesRepository: {
    findByUuid: vi.fn(),
  },
  endpointsRepository: {
    findByUuid: vi.fn(),
  },
  namespaceMappingsRepository: {
    findToolDeferLoadingOverrides: vi.fn(),
  },
  toolSearchConfigRepository: {
    findByNamespaceUuid: vi.fn(),
  },
}));

// Import after mocking
import {
  TOOL_SEARCH_TOOL_NAME,
  TOOL_SEARCH_TOOL_DEFINITION,
  executeToolSearch,
  shouldIncludeSearchTool,
  isToolSearchArguments,
  type ToolReferenceBlock,
} from "../builtin-tools/tool-search-tool.js";
import {
  DeferLoadingMiddleware,
  resolveDeferLoadingConfig,
  type ResolvedDeferLoadingConfig,
  type NamespaceConfig,
  type EndpointConfig,
} from "../middleware/defer-loading.js";
import { RegexSearchProvider } from "../tool-search/regex-search-provider.js";
import { BM25SearchProvider } from "../tool-search/bm25-search-provider.js";

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a mock Tool for testing
 */
const createMockTool = (
  name: string,
  description: string,
  serverName: string = "testserver"
): Tool => ({
  name: `${serverName}__${name}`,
  description,
  inputSchema: {
    type: "object" as const,
    properties: {
      input: { type: "string", description: "Input parameter" },
    },
    required: ["input"],
  },
});

/**
 * Sample tools simulating a typical MCP server setup
 */
const createSampleTools = (): Tool[] => [
  createMockTool("read_file", "Read contents of a file from disk", "filesystem"),
  createMockTool("write_file", "Write content to a file on disk", "filesystem"),
  createMockTool("list_directory", "List files in a directory", "filesystem"),
  createMockTool("fetch_url", "Fetch content from a URL", "web"),
  createMockTool("post_request", "Send a POST request to a URL", "web"),
  createMockTool("query_database", "Execute a SQL query", "database"),
  createMockTool("insert_record", "Insert a record into database", "database"),
  createMockTool("search_code", "Search for code patterns", "code"),
  createMockTool("run_tests", "Run test suite", "testing"),
  createMockTool("deploy_app", "Deploy application to production", "devops"),
];

/**
 * Sample tools with server UUIDs for search
 */
const createToolsWithServerUuids = (): Array<{ tool: Tool; serverUuid: string }> =>
  createSampleTools().map((tool, index) => ({
    tool,
    serverUuid: `server-uuid-${Math.floor(index / 3)}`,
  }));

// =============================================================================
// Test 1: defer_loading Flag Verification
// =============================================================================

describe("E2E Test 1: defer_loading Flag Conformance with Anthropic's Advanced Tool Use", () => {
  let middleware: DeferLoadingMiddleware;
  let sampleTools: Tool[];

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = new DeferLoadingMiddleware();
    sampleTools = createSampleTools();
  });

  describe("Scenario: Namespace configured with defer_loading enabled", () => {
    it("should inject defer_loading: true on all tools when globally enabled", async () => {
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
      };

      const result = await middleware.applyDeferLoading(sampleTools, config);

      // All tools should have defer_loading: true
      for (const tool of result) {
        expect(tool.defer_loading).toBe(true);
      }
    });

    it("should NOT inject defer_loading on the search tool itself", async () => {
      // Add the search tool to the list
      const toolsWithSearch = [...sampleTools, TOOL_SEARCH_TOOL_DEFINITION];

      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
      };

      const result = await middleware.applyDeferLoading(toolsWithSearch, config);

      // Search tool should NOT have defer_loading
      const searchTool = result.find((t) => t.name === TOOL_SEARCH_TOOL_NAME);
      expect(searchTool).toBeDefined();
      expect(searchTool?.defer_loading).toBeUndefined();

      // All other tools should have defer_loading: true
      const otherTools = result.filter((t) => t.name !== TOOL_SEARCH_TOOL_NAME);
      for (const tool of otherTools) {
        expect(tool.defer_loading).toBe(true);
      }
    });

    it("should respect per-tool overrides when specified", async () => {
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "REGEX",
        toolOverrides: {
          "filesystem__read_file": false, // Explicitly disable defer for this tool
        },
      };

      const result = await middleware.applyDeferLoading(sampleTools, config);

      // The overridden tool should NOT have defer_loading
      const readFileTool = result.find((t) => t.name === "filesystem__read_file");
      expect(readFileTool?.defer_loading).toBeUndefined();

      // Other tools should still have defer_loading: true
      const writeFileTool = result.find((t) => t.name === "filesystem__write_file");
      expect(writeFileTool?.defer_loading).toBe(true);
    });

    it("should handle DISABLED at endpoint level overriding namespace default", async () => {
      // When endpoint disables defer_loading, tools should NOT have the flag
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: false, // Endpoint override disabled it
        searchMethod: "NONE",
        toolOverrides: {},
      };

      const result = await middleware.applyDeferLoading(sampleTools, config);

      // No tools should have defer_loading
      for (const tool of result) {
        expect(tool.defer_loading).toBeUndefined();
      }
    });
  });

  describe("Scenario: Configuration resolution hierarchy", () => {
    it("should use namespace defaults when endpoint uses INHERIT", () => {
      const namespace: NamespaceConfig = {
        default_defer_loading: true,
        default_search_method: "BM25",
      };
      const endpoint: EndpointConfig = {
        override_defer_loading: "INHERIT",
        override_search_method: "INHERIT",
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      expect(resolved.deferLoadingEnabled).toBe(true);
      expect(resolved.searchMethod).toBe("BM25");
    });

    it("should override namespace defaults with endpoint ENABLED", () => {
      const namespace: NamespaceConfig = {
        default_defer_loading: false, // Namespace has it disabled
        default_search_method: "NONE",
      };
      const endpoint: EndpointConfig = {
        override_defer_loading: "ENABLED", // But endpoint enables it
        override_search_method: "REGEX",
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      expect(resolved.deferLoadingEnabled).toBe(true);
      expect(resolved.searchMethod).toBe("REGEX");
    });

    it("should override namespace defaults with endpoint DISABLED", () => {
      const namespace: NamespaceConfig = {
        default_defer_loading: true, // Namespace has it enabled
        default_search_method: "BM25",
      };
      const endpoint: EndpointConfig = {
        override_defer_loading: "DISABLED", // But endpoint disables it
        override_search_method: "INHERIT",
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      expect(resolved.deferLoadingEnabled).toBe(false);
      // search_method is inherited from namespace
      expect(resolved.searchMethod).toBe("BM25");
    });

    it("should include per-tool overrides in resolved config", () => {
      const namespace: NamespaceConfig = {
        default_defer_loading: true,
        default_search_method: "BM25",
      };
      const endpoint: EndpointConfig = {
        override_defer_loading: "INHERIT",
        override_search_method: "INHERIT",
      };
      const toolOverrides = {
        "filesystem__read_file": false,
        "web__fetch_url": true,
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, toolOverrides);

      expect(resolved.toolOverrides).toEqual(toolOverrides);
    });
  });

  describe("Scenario: Verify flag format matches Anthropic specification", () => {
    it("should return defer_loading as boolean true (not string or number)", async () => {
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
      };

      const result = await middleware.applyDeferLoading(sampleTools, config);

      for (const tool of result) {
        // Strict type check - must be exactly boolean true
        expect(typeof tool.defer_loading).toBe("boolean");
        expect(tool.defer_loading).toBe(true);
      }
    });

    it("should preserve all other tool properties when adding defer_loading", async () => {
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
      };

      const originalTool = sampleTools[0];
      const result = await middleware.applyDeferLoading([originalTool], config);
      const processedTool = result[0];

      // All original properties should be preserved
      expect(processedTool.name).toBe(originalTool.name);
      expect(processedTool.description).toBe(originalTool.description);
      expect(processedTool.inputSchema).toEqual(originalTool.inputSchema);
      // And defer_loading should be added
      expect(processedTool.defer_loading).toBe(true);
    });
  });
});

// =============================================================================
// Test 2: Tool Filtering - Only Search Tool Visible
// =============================================================================

describe("E2E Test 2: Tool Filtering with defer_loading Enabled", () => {
  describe("Scenario: When defer_loading is enabled, search tool is included", () => {
    it("should include search tool when defer_loading=true and search_method is not NONE", () => {
      // Test with BM25
      expect(
        shouldIncludeSearchTool({
          default_defer_loading: true,
          default_search_method: "BM25",
        })
      ).toBe(true);

      // Test with REGEX
      expect(
        shouldIncludeSearchTool({
          default_defer_loading: true,
          default_search_method: "REGEX",
        })
      ).toBe(true);

      // Test with EMBEDDINGS (future-proofing)
      expect(
        shouldIncludeSearchTool({
          default_defer_loading: true,
          default_search_method: "EMBEDDINGS",
        })
      ).toBe(true);
    });

    it("should NOT include search tool when defer_loading=false", () => {
      expect(
        shouldIncludeSearchTool({
          default_defer_loading: false,
          default_search_method: "BM25",
        })
      ).toBe(false);
    });

    it("should NOT include search tool when search_method=NONE", () => {
      expect(
        shouldIncludeSearchTool({
          default_defer_loading: true,
          default_search_method: "NONE",
        })
      ).toBe(false);
    });
  });

  describe("Scenario: Simulating client-visible tool list", () => {
    let middleware: DeferLoadingMiddleware;
    let sampleTools: Tool[];

    beforeEach(() => {
      vi.clearAllMocks();
      middleware = new DeferLoadingMiddleware();
      sampleTools = createSampleTools();
    });

    it("should result in search tool being immediately usable, others deferred", async () => {
      // Simulate what a client sees when connecting to MetaMCP with defer_loading enabled
      const namespaceConfig = {
        default_defer_loading: true,
        default_search_method: "BM25" as const,
      };

      // 1. Check if search tool should be included
      const includeSearchTool = shouldIncludeSearchTool(namespaceConfig);
      expect(includeSearchTool).toBe(true);

      // 2. Build the tool list that would be returned
      const allTools = includeSearchTool
        ? [...sampleTools, TOOL_SEARCH_TOOL_DEFINITION]
        : sampleTools;

      // 3. Apply defer_loading middleware
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
      };
      const processedTools = await middleware.applyDeferLoading(allTools, config);

      // Verify: Search tool is immediately usable (no defer_loading flag)
      const searchTool = processedTools.find((t) => t.name === TOOL_SEARCH_TOOL_NAME);
      expect(searchTool).toBeDefined();
      expect(searchTool?.defer_loading).toBeUndefined();

      // Verify: All other tools have defer_loading: true
      const deferredTools = processedTools.filter(
        (t) => t.name !== TOOL_SEARCH_TOOL_NAME
      );
      expect(deferredTools.length).toBe(sampleTools.length);
      for (const tool of deferredTools) {
        expect(tool.defer_loading).toBe(true);
      }
    });

    it("should allow models to see all tool names/descriptions even when deferred", async () => {
      const namespaceConfig = {
        default_defer_loading: true,
        default_search_method: "BM25" as const,
      };

      const allTools = [...sampleTools, TOOL_SEARCH_TOOL_DEFINITION];
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
      };
      const processedTools = await middleware.applyDeferLoading(allTools, config);

      // Models can still see all tool metadata (name, description, schema)
      // They just need to "load" deferred tools before using them
      expect(processedTools.length).toBe(sampleTools.length + 1);

      for (const tool of processedTools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe("string");
        expect(tool.inputSchema).toBeDefined();
        // Description may be optional but should exist for our test tools
        if (tool.description) {
          expect(typeof tool.description).toBe("string");
        }
      }
    });
  });
});

// =============================================================================
// Test 3: Model Workflow - Search, Discover, Invoke
// =============================================================================

describe("E2E Test 3: Model Workflow - Search Tool Invocation and Tool Discovery", () => {
  let toolsWithServerUuids: Array<{ tool: Tool; serverUuid: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    toolsWithServerUuids = createToolsWithServerUuids();
  });

  describe("Scenario: Model uses search tool to discover tools (without client defer support)", () => {
    it("should successfully invoke search tool and receive tool_reference blocks", async () => {
      // Step 1: Model calls the search tool with a query
      // Note: REGEX provider uses literal substring matching, so we use a single word
      const searchArgs = {
        query: "file", // Single word for regex literal match
        max_results: 5,
      };

      // Validate args using type guard (as metamcp-proxy would)
      expect(isToolSearchArguments(searchArgs)).toBe(true);

      // Step 2: Execute search using REGEX provider
      const result = await executeToolSearch(searchArgs, toolsWithServerUuids, {
        searchMethod: "REGEX",
        maxResults: 5,
      });

      // Step 3: Verify response contains tool_reference blocks
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);

      // Each block should be a valid tool_reference
      for (const block of result.content) {
        expect(block.type).toBe("tool_reference");
        expect(block.name).toBeDefined();
        expect(typeof block.name).toBe("string");
        expect(block.description).toBeDefined();
      }
    });

    it("should return relevant tools when searching for 'file' operations", async () => {
      const result = await executeToolSearch(
        { query: "file" },
        toolsWithServerUuids,
        { searchMethod: "REGEX", maxResults: 10 }
      );

      // Should find filesystem tools
      const toolNames = result.content.map((b) => b.name);

      // At least one file-related tool should be found
      const hasFileTools = toolNames.some(
        (name) =>
          name.includes("read_file") ||
          name.includes("write_file") ||
          name.includes("list_directory")
      );
      expect(hasFileTools).toBe(true);
    });

    it("should return relevant tools when searching for 'database' operations", async () => {
      const result = await executeToolSearch(
        { query: "database" },
        toolsWithServerUuids,
        { searchMethod: "REGEX", maxResults: 10 }
      );

      // Should find database tools
      const toolNames = result.content.map((b) => b.name);
      const hasDbTools = toolNames.some(
        (name) =>
          name.includes("query_database") || name.includes("insert_record")
      );
      expect(hasDbTools).toBe(true);
    });

    it("should respect max_results parameter", async () => {
      const result = await executeToolSearch(
        { query: "file", max_results: 2 },
        toolsWithServerUuids,
        { searchMethod: "REGEX", maxResults: 10 }
      );

      expect(result.content.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Scenario: Model workflow with BM25 search (more sophisticated)", () => {
    it("should rank tools by relevance using BM25 algorithm", async () => {
      const result = await executeToolSearch(
        { query: "read contents from disk" },
        toolsWithServerUuids,
        { searchMethod: "BM25", maxResults: 5 }
      );

      expect(result.content.length).toBeGreaterThan(0);

      // The first result should be the most relevant
      // For "read contents from disk", read_file should score highly
      if (result.content.length > 0) {
        const firstMatch = result.content[0];
        expect(firstMatch.type).toBe("tool_reference");
        // Should match something related to reading
        expect(
          firstMatch.name.includes("read") ||
            firstMatch.description.toLowerCase().includes("read")
        ).toBe(true);
      }
    });

    it("should handle natural language queries", async () => {
      const result = await executeToolSearch(
        { query: "I need to send data to a web server" },
        toolsWithServerUuids,
        { searchMethod: "BM25", maxResults: 5 }
      );

      expect(result.content.length).toBeGreaterThan(0);

      // Should find web-related tools
      const hasWebTools = result.content.some(
        (b) =>
          b.name.includes("fetch") ||
          b.name.includes("post") ||
          b.name.includes("web")
      );
      expect(hasWebTools).toBe(true);
    });
  });

  describe("Scenario: Complete model workflow simulation", () => {
    let middleware: DeferLoadingMiddleware;

    beforeEach(() => {
      vi.clearAllMocks();
      middleware = new DeferLoadingMiddleware();
    });

    it("should complete full workflow: connect -> list tools -> search -> find -> invoke", async () => {
      // Step 1: Client connects and receives tool list
      const allTools = createSampleTools();
      const namespaceConfig = {
        default_defer_loading: true,
        default_search_method: "BM25" as const,
      };

      // Add search tool if enabled
      const toolsToServe = shouldIncludeSearchTool(namespaceConfig)
        ? [...allTools, TOOL_SEARCH_TOOL_DEFINITION]
        : allTools;

      // Apply defer_loading middleware
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
      };
      const clientToolList = await middleware.applyDeferLoading(
        toolsToServe,
        config
      );

      // Step 2: Model sees the tool list
      // - Search tool is immediately usable
      // - Other tools have defer_loading: true
      const searchToolAvailable = clientToolList.find(
        (t) => t.name === TOOL_SEARCH_TOOL_NAME
      );
      expect(searchToolAvailable).toBeDefined();
      expect(searchToolAvailable?.defer_loading).toBeUndefined();

      // Step 3: Model decides it needs to work with files
      // It invokes the search tool to find relevant tools
      const searchArgs = { query: "file operations read write" };
      expect(isToolSearchArguments(searchArgs)).toBe(true);

      const searchResult = await executeToolSearch(
        searchArgs,
        toolsWithServerUuids,
        { searchMethod: "BM25", maxResults: 5 }
      );

      // Step 4: Model receives tool_reference blocks
      expect(searchResult.content.length).toBeGreaterThan(0);

      // Step 5: Model finds the tool it needs
      const foundTools = searchResult.content.map((ref) => ref.name);

      // The model can now use any of these tool names to invoke them
      // (In real scenario, the client would "load" the deferred tool)
      expect(foundTools.length).toBeGreaterThan(0);

      // Step 6: Verify the found tools can be invoked
      // In a real scenario, the model would call tools/call with the tool name
      // Here we just verify the tool names are valid and exist in our original list
      for (const toolName of foundTools) {
        const exists = allTools.some((t) => t.name === toolName);
        expect(exists).toBe(true);
      }
    });

    it("should work even when client does NOT support defer_loading (legacy client)", async () => {
      // Legacy clients ignore defer_loading flag but can still use search tool
      const allTools = createSampleTools();

      // Search tool is included
      const toolsToServe = [...allTools, TOOL_SEARCH_TOOL_DEFINITION];

      // Apply middleware (defer_loading flags are added)
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "REGEX",
        toolOverrides: {},
      };
      const processedTools = await middleware.applyDeferLoading(
        toolsToServe,
        config
      );

      // Legacy client ignores defer_loading but sees all tools
      // It can directly call any tool, including search tool
      expect(processedTools.length).toBe(allTools.length + 1);

      // Legacy client can still use search tool to discover what's available
      // Note: REGEX provider uses literal substring matching, so we use a single word
      const searchResult = await executeToolSearch(
        { query: "deploy" }, // Single word for regex literal match
        toolsWithServerUuids,
        { searchMethod: "REGEX", maxResults: 5 }
      );

      // Find devops tool
      const hasDeployTool = searchResult.content.some((ref) =>
        ref.name.includes("deploy")
      );
      expect(hasDeployTool).toBe(true);
    });
  });

  describe("Scenario: Edge cases and error handling", () => {
    it("should handle empty search query gracefully", async () => {
      const result = await executeToolSearch(
        { query: "" },
        toolsWithServerUuids,
        { searchMethod: "REGEX", maxResults: 5 }
      );

      // Should return empty or minimal results
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
    });

    it("should handle query with no matches", async () => {
      const result = await executeToolSearch(
        { query: "xyznonexistenttoolxyz12345" },
        toolsWithServerUuids,
        { searchMethod: "REGEX", maxResults: 5 }
      );

      expect(result.content).toHaveLength(0);
    });

    it("should validate search arguments with type guard", () => {
      // Valid arguments
      expect(isToolSearchArguments({ query: "test" })).toBe(true);
      expect(isToolSearchArguments({ query: "test", max_results: 5 })).toBe(
        true
      );

      // Invalid arguments
      expect(isToolSearchArguments(null)).toBe(false);
      expect(isToolSearchArguments(undefined)).toBe(false);
      expect(isToolSearchArguments({})).toBe(false);
      expect(isToolSearchArguments({ max_results: 5 })).toBe(false);
      expect(isToolSearchArguments({ query: 123 })).toBe(false);
      expect(isToolSearchArguments({ query: "test", max_results: "5" })).toBe(
        false
      );
    });

    it("should handle empty tool list", async () => {
      const result = await executeToolSearch(
        { query: "anything" },
        [],
        { searchMethod: "REGEX", maxResults: 5 }
      );

      expect(result.content).toHaveLength(0);
    });
  });
});

// =============================================================================
// Test 4: Integration with Search Providers
// =============================================================================

describe("E2E Test 4: Search Provider Integration", () => {
  describe("Regex Search Provider", () => {
    it("should find tools using regex pattern matching", async () => {
      const provider = new RegexSearchProvider();
      const tools = createToolsWithServerUuids();

      const results = await provider.search(
        { query: "file", maxResults: 10 },
        tools,
        {}
      );

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(
          result.tool.name.includes("file") ||
            result.tool.description?.toLowerCase().includes("file")
        ).toBe(true);
      }
    });

    it("should be case insensitive by default", async () => {
      const provider = new RegexSearchProvider();
      const tools = createToolsWithServerUuids();

      const resultsLower = await provider.search(
        { query: "file", maxResults: 10 },
        tools,
        {}
      );

      const resultsUpper = await provider.search(
        { query: "FILE", maxResults: 10 },
        tools,
        {}
      );

      expect(resultsLower.length).toBe(resultsUpper.length);
    });
  });

  describe("BM25 Search Provider", () => {
    it("should find tools using BM25 ranking", async () => {
      const provider = new BM25SearchProvider();
      const tools = createToolsWithServerUuids();

      const results = await provider.search(
        { query: "read file disk", maxResults: 5 },
        tools,
        {}
      );

      expect(results.length).toBeGreaterThan(0);

      // Results should be ordered by score (highest first)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("should handle multi-word queries effectively", async () => {
      const provider = new BM25SearchProvider();
      const tools = createToolsWithServerUuids();

      const results = await provider.search(
        { query: "send http request url", maxResults: 5 },
        tools,
        {}
      );

      // Should find web-related tools
      const hasWebTools = results.some(
        (r) => r.tool.name.includes("fetch") || r.tool.name.includes("post")
      );
      expect(hasWebTools).toBe(true);
    });
  });
});

// =============================================================================
// Test 5: Tool Reference Block Format Verification
// =============================================================================

describe("E2E Test 5: Tool Reference Block Format Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return blocks conforming to Anthropic tool_reference specification", async () => {
    const result = await executeToolSearch(
      { query: "file" },
      createToolsWithServerUuids(),
      { searchMethod: "REGEX", maxResults: 3 }
    );

    for (const block of result.content) {
      // Must have exactly these properties for Anthropic compatibility
      expect(block).toHaveProperty("type", "tool_reference");
      expect(block).toHaveProperty("name");
      expect(block).toHaveProperty("description");

      // Type must be exactly "tool_reference"
      expect(block.type).toBe("tool_reference");

      // Name must be a non-empty string
      expect(typeof block.name).toBe("string");
      expect(block.name.length).toBeGreaterThan(0);

      // Description must be a string
      expect(typeof block.description).toBe("string");
    }
  });

  it("should include score and match reason in description for debugging", async () => {
    const result = await executeToolSearch(
      { query: "database" },
      createToolsWithServerUuids(),
      { searchMethod: "REGEX", maxResults: 3 }
    );

    for (const block of result.content) {
      // Description should contain score info
      expect(block.description).toContain("score:");
      // Description should contain match reason
      expect(block.description.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Test 6: Server-Side Middleware Processing (Part 2)
// =============================================================================

describe("E2E Test 6: Server-Side Middleware Processing (Part 2)", () => {
  /**
   * Part 2 verifies that the server-side middleware correctly processes tools
   * regardless of client capabilities. This is distinct from Part 1 (defer_loading flag)
   * which relies on client support.
   *
   * Server-side processing includes:
   * 1. Configuration resolution (namespace -> endpoint -> tool level)
   * 2. Search tool injection (only when configured)
   * 3. defer_loading flag injection (server-side, not client dependent)
   * 4. Filter middleware (for inactive tools)
   */

  let middleware: DeferLoadingMiddleware;
  let sampleTools: Tool[];

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = new DeferLoadingMiddleware();
    sampleTools = createSampleTools();
  });

  describe("Scenario: Server-side tool list construction", () => {
    it("should construct tool list with search tool when properly configured", async () => {
      // Server-side: Build tool list based on configuration
      const namespaceConfig = {
        default_defer_loading: true,
        default_search_method: "BM25" as const,
      };

      // Step 1: Determine if search tool should be included (server-side decision)
      const includeSearchTool = shouldIncludeSearchTool(namespaceConfig);
      expect(includeSearchTool).toBe(true);

      // Step 2: Server builds tool list
      const serverToolList = includeSearchTool
        ? [...sampleTools, TOOL_SEARCH_TOOL_DEFINITION]
        : sampleTools;

      // Step 3: Server applies middleware (this happens server-side, not client-side)
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
      };
      const processedList = await middleware.applyDeferLoading(serverToolList, config);

      // Verification: Server returns processed list to client
      // Client sees: search tool (no defer_loading) + other tools (defer_loading: true)
      const searchTool = processedList.find((t) => t.name === TOOL_SEARCH_TOOL_NAME);
      const otherTools = processedList.filter((t) => t.name !== TOOL_SEARCH_TOOL_NAME);

      expect(searchTool).toBeDefined();
      expect(searchTool?.defer_loading).toBeUndefined();
      expect(otherTools.every((t) => t.defer_loading === true)).toBe(true);
    });

    it("should NOT include search tool when search_method is NONE", async () => {
      const namespaceConfig = {
        default_defer_loading: true,
        default_search_method: "NONE" as const,
      };

      // Server-side decision: Don't include search tool
      const includeSearchTool = shouldIncludeSearchTool(namespaceConfig);
      expect(includeSearchTool).toBe(false);

      // Tool list without search tool
      const serverToolList = sampleTools; // No search tool added

      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "NONE",
        toolOverrides: {},
      };
      const processedList = await middleware.applyDeferLoading(serverToolList, config);

      // Search tool should NOT be in the list
      const searchTool = processedList.find((t) => t.name === TOOL_SEARCH_TOOL_NAME);
      expect(searchTool).toBeUndefined();

      // Other tools still have defer_loading: true
      expect(processedList.every((t) => t.defer_loading === true)).toBe(true);
    });

    it("should NOT include search tool when defer_loading is disabled", async () => {
      const namespaceConfig = {
        default_defer_loading: false,
        default_search_method: "BM25" as const,
      };

      // Server-side decision: Don't include search tool when defer_loading is disabled
      const includeSearchTool = shouldIncludeSearchTool(namespaceConfig);
      expect(includeSearchTool).toBe(false);

      // Tool list without modifications
      const serverToolList = sampleTools;

      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: false,
        searchMethod: "BM25",
        toolOverrides: {},
      };
      const processedList = await middleware.applyDeferLoading(serverToolList, config);

      // No defer_loading flags when disabled
      expect(processedList.every((t) => t.defer_loading === undefined)).toBe(true);
    });
  });

  describe("Scenario: Server-side middleware independence from client", () => {
    it("should process tools server-side regardless of client capabilities", async () => {
      // This test verifies that the server does its own processing
      // regardless of whether the client supports defer_loading

      const namespaceConfig = {
        default_defer_loading: true,
        default_search_method: "REGEX" as const,
      };

      // Server builds and processes tool list
      const toolsWithSearch = [...sampleTools, TOOL_SEARCH_TOOL_DEFINITION];
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "REGEX",
        toolOverrides: {},
      };
      const serverResponse = await middleware.applyDeferLoading(toolsWithSearch, config);

      // Scenario A: Smart client that supports defer_loading
      // - Client receives tools with defer_loading: true
      // - Client defers loading those tools until needed
      // - Client can use search tool immediately

      // Scenario B: Legacy client that ignores defer_loading
      // - Client receives same tools with defer_loading: true
      // - Client ignores the flag and loads all tools
      // - Client can still use search tool to discover what's available

      // Both scenarios receive the same server response
      expect(serverResponse.length).toBe(sampleTools.length + 1);

      // The server's job is done - it provides:
      // 1. Search tool (immediately usable)
      // 2. Other tools (marked with defer_loading: true)
      // 3. All tools callable regardless of defer_loading flag
    });

    it("should allow direct tool invocation even with defer_loading: true", async () => {
      // This verifies that defer_loading is a HINT, not a blocker
      // Tools with defer_loading: true can still be called directly

      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
      };

      const processedTools = await middleware.applyDeferLoading(sampleTools, config);

      // All tools have defer_loading: true
      expect(processedTools.every((t) => t.defer_loading === true)).toBe(true);

      // But they are all present in the list and can be called
      expect(processedTools.length).toBe(sampleTools.length);

      // Each tool name is preserved and callable
      for (const originalTool of sampleTools) {
        const processedTool = processedTools.find((t) => t.name === originalTool.name);
        expect(processedTool).toBeDefined();
        expect(processedTool?.name).toBe(originalTool.name);
        expect(processedTool?.inputSchema).toEqual(originalTool.inputSchema);
      }
    });
  });

  describe("Scenario: Configuration hierarchy in server-side processing", () => {
    it("should apply namespace-level configuration by default", () => {
      const namespace: NamespaceConfig = {
        default_defer_loading: true,
        default_search_method: "BM25",
      };
      const endpoint: EndpointConfig = {
        override_defer_loading: "INHERIT",
        override_search_method: "INHERIT",
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      expect(resolved.deferLoadingEnabled).toBe(true);
      expect(resolved.searchMethod).toBe("BM25");
    });

    it("should apply endpoint-level overrides when specified", () => {
      const namespace: NamespaceConfig = {
        default_defer_loading: false, // Namespace: disabled
        default_search_method: "NONE",
      };
      const endpoint: EndpointConfig = {
        override_defer_loading: "ENABLED", // Endpoint: enabled
        override_search_method: "REGEX",
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      // Endpoint overrides namespace
      expect(resolved.deferLoadingEnabled).toBe(true);
      expect(resolved.searchMethod).toBe("REGEX");
    });

    it("should apply per-tool overrides for fine-grained control", async () => {
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {
          "filesystem__read_file": false, // This specific tool: no defer
          "web__fetch_url": false, // This specific tool: no defer
        },
      };

      const processedTools = await middleware.applyDeferLoading(sampleTools, config);

      // Overridden tools: no defer_loading
      const readFile = processedTools.find((t) => t.name === "filesystem__read_file");
      const fetchUrl = processedTools.find((t) => t.name === "web__fetch_url");
      expect(readFile?.defer_loading).toBeUndefined();
      expect(fetchUrl?.defer_loading).toBeUndefined();

      // Other tools: defer_loading: true
      const writeFile = processedTools.find((t) => t.name === "filesystem__write_file");
      const queryDb = processedTools.find((t) => t.name === "database__query_database");
      expect(writeFile?.defer_loading).toBe(true);
      expect(queryDb?.defer_loading).toBe(true);
    });
  });
});

// =============================================================================
// Test 7: Tool Visibility Mode - SEARCH_ONLY (Part 2 - Strict Filtering)
// =============================================================================

describe("E2E Test 7: Tool Visibility Mode - SEARCH_ONLY (Part 2 - Strict Filtering)", () => {
  /**
   * Part 2 (strict filtering) verifies that when toolVisibility is SEARCH_ONLY:
   * - The server ONLY returns the search tool
   * - All other tools are filtered out from the tools/list response
   * - Tools can only be discovered via the search tool
   *
   * This is distinct from the defer_loading flag which:
   * - Returns ALL tools but marks them with defer_loading: true
   * - Relies on client support for the defer_loading flag
   *
   * SEARCH_ONLY mode is for clients that don't support defer_loading
   * or when you want maximum context window savings.
   */

  let middleware: DeferLoadingMiddleware;
  let sampleTools: Tool[];

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = new DeferLoadingMiddleware();
    sampleTools = createSampleTools();
  });

  describe("Scenario: SEARCH_ONLY mode filters out all tools except search tool", () => {
    it("should only return search tool when toolVisibility is SEARCH_ONLY", () => {
      // Add search tool to the list
      const toolsWithSearch = [...sampleTools, TOOL_SEARCH_TOOL_DEFINITION];

      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
        toolVisibility: "SEARCH_ONLY",
      };

      // Apply tool visibility filter
      const filteredTools = middleware.applyToolVisibilityFilter(
        toolsWithSearch,
        config
      );

      // Only search tool should remain
      expect(filteredTools.length).toBe(1);
      expect(filteredTools[0].name).toBe(TOOL_SEARCH_TOOL_NAME);
    });

    it("should return empty array if search tool is not in list with SEARCH_ONLY", () => {
      // List without search tool
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
        toolVisibility: "SEARCH_ONLY",
      };

      const filteredTools = middleware.applyToolVisibilityFilter(
        sampleTools,
        config
      );

      // No tools should remain
      expect(filteredTools.length).toBe(0);
    });

    it("should return all tools when toolVisibility is ALL", () => {
      const toolsWithSearch = [...sampleTools, TOOL_SEARCH_TOOL_DEFINITION];

      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
        toolVisibility: "ALL",
      };

      const filteredTools = middleware.applyToolVisibilityFilter(
        toolsWithSearch,
        config
      );

      // All tools should remain
      expect(filteredTools.length).toBe(sampleTools.length + 1);
    });
  });

  describe("Scenario: Configuration resolution includes toolVisibility", () => {
    it("should resolve toolVisibility from namespace defaults", () => {
      const namespace: NamespaceConfig = {
        default_defer_loading: true,
        default_search_method: "BM25",
        default_tool_visibility: "SEARCH_ONLY",
      };
      const endpoint: EndpointConfig = {
        override_defer_loading: "INHERIT",
        override_search_method: "INHERIT",
        override_tool_visibility: null, // Inherit from namespace
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      expect(resolved.toolVisibility).toBe("SEARCH_ONLY");
    });

    it("should override namespace toolVisibility with endpoint setting", () => {
      const namespace: NamespaceConfig = {
        default_defer_loading: true,
        default_search_method: "BM25",
        default_tool_visibility: "ALL", // Namespace says ALL
      };
      const endpoint: EndpointConfig = {
        override_defer_loading: "INHERIT",
        override_search_method: "INHERIT",
        override_tool_visibility: "SEARCH_ONLY", // Endpoint overrides to SEARCH_ONLY
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      expect(resolved.toolVisibility).toBe("SEARCH_ONLY");
    });

    it("should default to ALL when toolVisibility is not specified", () => {
      const namespace: NamespaceConfig = {
        default_defer_loading: true,
        default_search_method: "BM25",
        // No default_tool_visibility specified
      };
      const endpoint: EndpointConfig = {
        override_defer_loading: "INHERIT",
        override_search_method: "INHERIT",
        // No override_tool_visibility specified
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      expect(resolved.toolVisibility).toBe("ALL");
    });
  });

  describe("Scenario: Full workflow with SEARCH_ONLY mode", () => {
    it("should complete workflow: filtered list -> search -> discover -> invoke", async () => {
      // Step 1: Client connects and requests tool list
      const allTools = createSampleTools();
      const toolsWithSearch = [...allTools, TOOL_SEARCH_TOOL_DEFINITION];

      // Step 2: Server applies defer_loading middleware
      const config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
        toolVisibility: "SEARCH_ONLY",
      };
      const processedTools = await middleware.applyDeferLoading(
        toolsWithSearch,
        config
      );

      // Step 3: Server applies tool visibility filter (SEARCH_ONLY)
      const filteredTools = middleware.applyToolVisibilityFilter(
        processedTools,
        config
      );

      // Client only sees the search tool
      expect(filteredTools.length).toBe(1);
      expect(filteredTools[0].name).toBe(TOOL_SEARCH_TOOL_NAME);

      // Step 4: Model invokes search tool to discover what's available
      const toolsForSearch = allTools.map((tool, index) => ({
        tool,
        serverUuid: `server-uuid-${Math.floor(index / 3)}`,
      }));

      const searchResult = await executeToolSearch(
        { query: "file" },
        toolsForSearch,
        { searchMethod: "BM25", maxResults: 5 }
      );

      // Model discovers file-related tools
      expect(searchResult.content.length).toBeGreaterThan(0);
      const hasFileTools = searchResult.content.some(
        (ref) =>
          ref.name.includes("read_file") || ref.name.includes("write_file")
      );
      expect(hasFileTools).toBe(true);

      // Step 5: Model can invoke discovered tools by name
      // (Even though they weren't in the initial tools/list response)
      const discoveredToolName = searchResult.content[0].name;
      const toolExists = allTools.some((t) => t.name === discoveredToolName);
      expect(toolExists).toBe(true);
    });

    it("should allow maximum context savings with SEARCH_ONLY mode", async () => {
      // This test demonstrates the context window savings
      const allTools = createSampleTools();
      const toolsWithSearch = [...allTools, TOOL_SEARCH_TOOL_DEFINITION];

      // Without SEARCH_ONLY (ALL mode)
      const allModeConfig: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
        toolVisibility: "ALL",
      };
      const allModeTools = middleware.applyToolVisibilityFilter(
        toolsWithSearch,
        allModeConfig
      );

      // With SEARCH_ONLY mode
      const searchOnlyConfig: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
        toolVisibility: "SEARCH_ONLY",
      };
      const searchOnlyTools = middleware.applyToolVisibilityFilter(
        toolsWithSearch,
        searchOnlyConfig
      );

      // Dramatic reduction in tools returned
      expect(allModeTools.length).toBe(11); // 10 sample tools + 1 search tool
      expect(searchOnlyTools.length).toBe(1); // Only search tool

      // Context window savings: from 11 tools to 1 tool
      const contextSavingsPercent =
        ((allModeTools.length - searchOnlyTools.length) / allModeTools.length) *
        100;
      expect(contextSavingsPercent).toBeGreaterThan(90); // Over 90% reduction
    });
  });

  describe("Scenario: Comparison of Part 1 (defer_loading) vs Part 2 (SEARCH_ONLY)", () => {
    it("should demonstrate the difference between defer_loading and SEARCH_ONLY", async () => {
      const allTools = createSampleTools();
      const toolsWithSearch = [...allTools, TOOL_SEARCH_TOOL_DEFINITION];

      // Part 1: defer_loading flag only (ALL visibility)
      const part1Config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
        toolVisibility: "ALL",
      };
      const part1Tools = await middleware.applyDeferLoading(
        toolsWithSearch,
        part1Config
      );
      const part1Filtered = middleware.applyToolVisibilityFilter(
        part1Tools,
        part1Config
      );

      // Part 2: SEARCH_ONLY mode
      const part2Config: ResolvedDeferLoadingConfig = {
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
        toolVisibility: "SEARCH_ONLY",
      };
      const part2Tools = await middleware.applyDeferLoading(
        toolsWithSearch,
        part2Config
      );
      const part2Filtered = middleware.applyToolVisibilityFilter(
        part2Tools,
        part2Config
      );

      // Part 1: Client sees ALL tools (with defer_loading flag)
      expect(part1Filtered.length).toBe(11);
      const part1DeferredTools = part1Filtered.filter(
        (t) => t.defer_loading === true
      );
      expect(part1DeferredTools.length).toBe(10); // All except search tool

      // Part 2: Client sees ONLY search tool
      expect(part2Filtered.length).toBe(1);
      expect(part2Filtered[0].name).toBe(TOOL_SEARCH_TOOL_NAME);

      // Both approaches allow tool discovery via search
      // But Part 2 provides maximum context savings for non-supporting clients
    });
  });
});
