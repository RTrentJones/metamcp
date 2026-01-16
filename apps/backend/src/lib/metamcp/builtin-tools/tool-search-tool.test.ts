import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  TOOL_SEARCH_TOOL_NAME,
  TOOL_SEARCH_TOOL_DEFINITION,
  executeToolSearch,
  shouldIncludeSearchTool,
  createToolReferenceBlock,
} from "./tool-search-tool.js";

// Mock the tool search service
vi.mock("../tool-search/index.js", () => ({
  toolSearchService: {
    search: vi.fn(),
  },
}));

import { toolSearchService } from "../tool-search/index.js";

// Test data: Sample tools for testing
const createTool = (name: string, description: string): Tool => ({
  name,
  description,
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
});

const sampleTools: Array<{ tool: Tool; serverUuid: string }> = [
  {
    tool: createTool("file__read_file", "Read contents of a file"),
    serverUuid: "server-1",
  },
  {
    tool: createTool("file__write_file", "Write content to a file"),
    serverUuid: "server-1",
  },
  {
    tool: createTool("web__fetch_url", "Fetch content from a URL"),
    serverUuid: "server-2",
  },
];

describe("Tool Search Tool - Definition", () => {
  it("should have correct tool name", () => {
    expect(TOOL_SEARCH_TOOL_NAME).toBe("metamcp_search_tools");
  });

  it("should have valid tool definition structure", () => {
    expect(TOOL_SEARCH_TOOL_DEFINITION).toBeDefined();
    expect(TOOL_SEARCH_TOOL_DEFINITION.name).toBe(TOOL_SEARCH_TOOL_NAME);
    expect(TOOL_SEARCH_TOOL_DEFINITION.description).toBeDefined();
    expect(typeof TOOL_SEARCH_TOOL_DEFINITION.description).toBe("string");
    expect(TOOL_SEARCH_TOOL_DEFINITION.inputSchema).toBeDefined();
  });

  it("should have query parameter in inputSchema", () => {
    const schema = TOOL_SEARCH_TOOL_DEFINITION.inputSchema;
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeDefined();
    expect(schema.properties.query).toBeDefined();
    expect(schema.properties.query.type).toBe("string");
    expect(schema.required).toContain("query");
  });

  it("should have optional max_results parameter", () => {
    const schema = TOOL_SEARCH_TOOL_DEFINITION.inputSchema;
    expect(schema.properties.max_results).toBeDefined();
    expect(schema.properties.max_results.type).toBe("number");
    expect(schema.required).not.toContain("max_results");
  });
});

describe("Tool Search Tool - Conditional Inclusion", () => {
  it("should include search tool when defer_loading is true and search_method is not NONE", () => {
    expect(
      shouldIncludeSearchTool({
        default_defer_loading: true,
        default_search_method: "REGEX",
      })
    ).toBe(true);

    expect(
      shouldIncludeSearchTool({
        default_defer_loading: true,
        default_search_method: "BM25",
      })
    ).toBe(true);
  });

  it("should NOT include search tool when defer_loading is false", () => {
    expect(
      shouldIncludeSearchTool({
        default_defer_loading: false,
        default_search_method: "REGEX",
      })
    ).toBe(false);
  });

  it("should NOT include search tool when search_method is NONE", () => {
    expect(
      shouldIncludeSearchTool({
        default_defer_loading: true,
        default_search_method: "NONE",
      })
    ).toBe(false);
  });

  it("should NOT include search tool when both conditions fail", () => {
    expect(
      shouldIncludeSearchTool({
        default_defer_loading: false,
        default_search_method: "NONE",
      })
    ).toBe(false);
  });
});

describe("Tool Search Tool - Tool Reference Block Creation", () => {
  it("should create valid tool_reference block", () => {
    const result = createToolReferenceBlock({
      tool: sampleTools[0].tool,
      serverUuid: sampleTools[0].serverUuid,
      score: 0.85,
      matchReason: "Matched in name",
    });

    expect(result).toEqual({
      type: "tool_reference",
      name: "file__read_file",
      description: expect.stringContaining("Read contents of a file"),
    });
  });

  it("should include score and match reason in description", () => {
    const result = createToolReferenceBlock({
      tool: sampleTools[0].tool,
      serverUuid: sampleTools[0].serverUuid,
      score: 0.92,
      matchReason: "Matched in name, description",
    });

    expect(result.description).toContain("score: 0.92");
    expect(result.description).toContain("Matched in name, description");
  });

  it("should handle missing original description", () => {
    const toolWithoutDesc: Tool = {
      name: "test_tool",
      inputSchema: { type: "object", properties: {} },
    };

    const result = createToolReferenceBlock({
      tool: toolWithoutDesc,
      serverUuid: "server-x",
      score: 0.5,
      matchReason: "Matched",
    });

    expect(result.name).toBe("test_tool");
    expect(result.description).toBeDefined();
  });
});

describe("Tool Search Tool - Execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should execute search and return tool_reference blocks", async () => {
    // Mock search results
    vi.mocked(toolSearchService.search).mockResolvedValue([
      {
        tool: sampleTools[0].tool,
        serverUuid: sampleTools[0].serverUuid,
        score: 0.9,
        matchReason: "Matched in name",
      },
      {
        tool: sampleTools[1].tool,
        serverUuid: sampleTools[1].serverUuid,
        score: 0.7,
        matchReason: "Matched in description",
      },
    ]);

    const result = await executeToolSearch(
      {
        query: "file",
        max_results: 5,
      },
      sampleTools,
      {
        searchMethod: "REGEX",
        maxResults: 5,
      }
    );

    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe("tool_reference");
    expect(result.content[0].name).toBe("file__read_file");
    expect(result.content[1].type).toBe("tool_reference");
    expect(result.content[1].name).toBe("file__write_file");
  });

  it("should respect max_results from arguments", async () => {
    vi.mocked(toolSearchService.search).mockResolvedValue([
      {
        tool: sampleTools[0].tool,
        serverUuid: sampleTools[0].serverUuid,
        score: 0.9,
        matchReason: "Match",
      },
    ]);

    await executeToolSearch(
      {
        query: "file",
        max_results: 2,
      },
      sampleTools,
      {
        searchMethod: "REGEX",
        maxResults: 10,
      }
    );

    expect(toolSearchService.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "file",
        maxResults: 2,
      }),
      sampleTools,
      expect.anything()
    );
  });

  it("should use config maxResults when max_results not provided", async () => {
    vi.mocked(toolSearchService.search).mockResolvedValue([]);

    await executeToolSearch(
      {
        query: "test",
      },
      sampleTools,
      {
        searchMethod: "BM25",
        maxResults: 7,
      }
    );

    expect(toolSearchService.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "test",
        maxResults: 7,
      }),
      sampleTools,
      expect.anything()
    );
  });

  it("should handle empty query gracefully", async () => {
    vi.mocked(toolSearchService.search).mockResolvedValue([]);

    const result = await executeToolSearch(
      {
        query: "",
      },
      sampleTools,
      {
        searchMethod: "REGEX",
        maxResults: 5,
      }
    );

    expect(result.content).toHaveLength(0);
  });

  it("should handle no matches", async () => {
    vi.mocked(toolSearchService.search).mockResolvedValue([]);

    const result = await executeToolSearch(
      {
        query: "nonexistent_xyz",
      },
      sampleTools,
      {
        searchMethod: "REGEX",
        maxResults: 5,
      }
    );

    expect(result.content).toHaveLength(0);
  });

  it("should handle search service errors gracefully", async () => {
    vi.mocked(toolSearchService.search).mockRejectedValue(
      new Error("Search failed")
    );

    await expect(
      executeToolSearch(
        {
          query: "test",
        },
        sampleTools,
        {
          searchMethod: "REGEX",
          maxResults: 5,
        }
      )
    ).rejects.toThrow("Search failed");
  });

  it("should work with BM25 search method", async () => {
    vi.mocked(toolSearchService.search).mockResolvedValue([
      {
        tool: sampleTools[2].tool,
        serverUuid: sampleTools[2].serverUuid,
        score: 0.95,
        matchReason: "BM25 match",
      },
    ]);

    const result = await executeToolSearch(
      {
        query: "fetch web content",
      },
      sampleTools,
      {
        searchMethod: "BM25",
        maxResults: 5,
      }
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].name).toBe("web__fetch_url");
  });

  it("should return tool_reference blocks in correct format", async () => {
    vi.mocked(toolSearchService.search).mockResolvedValue([
      {
        tool: sampleTools[0].tool,
        serverUuid: sampleTools[0].serverUuid,
        score: 0.88,
        matchReason: "Test match",
      },
    ]);

    const result = await executeToolSearch(
      {
        query: "file",
      },
      sampleTools,
      {
        searchMethod: "REGEX",
        maxResults: 5,
      }
    );

    const block = result.content[0];
    expect(block).toMatchObject({
      type: "tool_reference",
      name: expect.any(String),
      description: expect.any(String),
    });
    expect(block.description).toContain("score:");
    expect(block.description).toContain("Test match");
  });
});

describe("Tool Search Tool - Integration with Search Methods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pass correct config to toolSearchService", async () => {
    vi.mocked(toolSearchService.search).mockResolvedValue([]);

    const config = {
      searchMethod: "BM25" as const,
      maxResults: 10,
      providerConfig: {
        k1: 1.5,
        b: 0.75,
      },
    };

    await executeToolSearch(
      {
        query: "test",
        max_results: 3,
      },
      sampleTools,
      config
    );

    expect(toolSearchService.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "test",
        maxResults: 3,
      }),
      sampleTools,
      config
    );
  });
});
