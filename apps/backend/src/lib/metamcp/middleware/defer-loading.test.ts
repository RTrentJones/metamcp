import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  DeferLoadingMiddleware,
  type DeferLoadingConfig,
  type ResolvedDeferLoadingConfig,
  resolveDeferLoadingConfig,
} from "./defer-loading.js";

// Mock the repositories that will be needed
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
}));

import {
  namespacesRepository,
  endpointsRepository,
  namespaceMappingsRepository,
} from "../../../db/repositories/index.js";

// Test data: Sample tools
const createTool = (name: string, description: string): Tool => ({
  name,
  description,
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
});

const sampleTools: Tool[] = [
  createTool("file__read_file", "Read contents of a file"),
  createTool("file__write_file", "Write content to a file"),
  createTool("web__fetch_url", "Fetch content from a URL"),
  createTool("db__query", "Execute database query"),
  createTool("metamcp_search_tools", "Search for tools (built-in)"),
];

describe("DeferLoadingMiddleware - Configuration Resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveDeferLoadingConfig", () => {
    it("should use namespace defaults when no endpoint override", () => {
      const namespace = {
        default_defer_loading: true,
        default_search_method: "BM25" as const,
      };
      const endpoint = {
        override_defer_loading: "INHERIT" as const,
        override_search_method: "INHERIT" as const,
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      expect(resolved).toEqual({
        deferLoadingEnabled: true,
        searchMethod: "BM25",
        toolOverrides: {},
        toolVisibility: "ALL",
      });
    });

    it("should use endpoint override when set", () => {
      const namespace = {
        default_defer_loading: false,
        default_search_method: "NONE" as const,
      };
      const endpoint = {
        override_defer_loading: "ENABLED" as const,
        override_search_method: "REGEX" as const,
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      expect(resolved).toEqual({
        deferLoadingEnabled: true,
        searchMethod: "REGEX",
        toolOverrides: {},
        toolVisibility: "ALL",
      });
    });

    it("should handle endpoint DISABLED override", () => {
      const namespace = {
        default_defer_loading: true,
        default_search_method: "BM25" as const,
      };
      const endpoint = {
        override_defer_loading: "DISABLED" as const,
        override_search_method: "INHERIT" as const,
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      expect(resolved.deferLoadingEnabled).toBe(false);
    });

    it("should include per-tool overrides in resolved config", () => {
      const namespace = {
        default_defer_loading: true,
        default_search_method: "BM25" as const,
      };
      const endpoint = {
        override_defer_loading: "INHERIT" as const,
        override_search_method: "INHERIT" as const,
      };
      const toolOverrides = {
        "file__read_file": false, // Explicitly disabled
        "web__fetch_url": true, // Explicitly enabled
      };

      const resolved = resolveDeferLoadingConfig(
        namespace,
        endpoint,
        toolOverrides
      );

      expect(resolved.toolOverrides).toEqual(toolOverrides);
    });

    it("should handle INHERIT for search_method", () => {
      const namespace = {
        default_defer_loading: true,
        default_search_method: "BM25" as const,
      };
      const endpoint = {
        override_defer_loading: "INHERIT" as const,
        override_search_method: "INHERIT" as const,
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      expect(resolved.searchMethod).toBe("BM25");
    });

    it("should override search_method when explicitly set", () => {
      const namespace = {
        default_defer_loading: true,
        default_search_method: "BM25" as const,
      };
      const endpoint = {
        override_defer_loading: "INHERIT" as const,
        override_search_method: "REGEX" as const,
      };

      const resolved = resolveDeferLoadingConfig(namespace, endpoint, {});

      expect(resolved.searchMethod).toBe("REGEX");
    });
  });
});

describe("DeferLoadingMiddleware - Flag Injection", () => {
  let middleware: DeferLoadingMiddleware;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = new DeferLoadingMiddleware();
  });

  it("should inject defer_loading: true when globally enabled", async () => {
    const config: ResolvedDeferLoadingConfig = {
      deferLoadingEnabled: true,
      searchMethod: "BM25",
      toolOverrides: {},
    };

    const result = await middleware.applyDeferLoading(sampleTools, config);

    // All tools except search tool should have defer_loading: true
    const nonSearchTools = result.filter(
      (t) => t.name !== "metamcp_search_tools"
    );
    for (const tool of nonSearchTools) {
      expect(tool.defer_loading).toBe(true);
    }
  });

  it("should NOT inject defer_loading when globally disabled", async () => {
    const config: ResolvedDeferLoadingConfig = {
      deferLoadingEnabled: false,
      searchMethod: "NONE",
      toolOverrides: {},
    };

    const result = await middleware.applyDeferLoading(sampleTools, config);

    // No tools should have defer_loading set
    for (const tool of result) {
      expect(tool.defer_loading).toBeUndefined();
    }
  });

  it("should respect per-tool override: false", async () => {
    const config: ResolvedDeferLoadingConfig = {
      deferLoadingEnabled: true,
      searchMethod: "BM25",
      toolOverrides: {
        "file__read_file": false, // Explicit disable
      },
    };

    const result = await middleware.applyDeferLoading(sampleTools, config);

    const readFileTool = result.find((t) => t.name === "file__read_file");
    expect(readFileTool?.defer_loading).toBeUndefined();

    const writeFileTool = result.find((t) => t.name === "file__write_file");
    expect(writeFileTool?.defer_loading).toBe(true);
  });

  it("should respect per-tool override: true", async () => {
    const config: ResolvedDeferLoadingConfig = {
      deferLoadingEnabled: false,
      searchMethod: "NONE",
      toolOverrides: {
        "web__fetch_url": true, // Explicit enable
      },
    };

    const result = await middleware.applyDeferLoading(sampleTools, config);

    const fetchTool = result.find((t) => t.name === "web__fetch_url");
    expect(fetchTool?.defer_loading).toBe(true);

    const readFileTool = result.find((t) => t.name === "file__read_file");
    expect(readFileTool?.defer_loading).toBeUndefined();
  });

  it("should NEVER inject defer_loading for metamcp_search_tools", async () => {
    const config: ResolvedDeferLoadingConfig = {
      deferLoadingEnabled: true,
      searchMethod: "BM25",
      toolOverrides: {
        metamcp_search_tools: true, // Even explicit override shouldn't work
      },
    };

    const result = await middleware.applyDeferLoading(sampleTools, config);

    const searchTool = result.find((t) => t.name === "metamcp_search_tools");
    expect(searchTool?.defer_loading).toBeUndefined();
  });

  it("should not mutate original tool objects", async () => {
    const config: ResolvedDeferLoadingConfig = {
      deferLoadingEnabled: true,
      searchMethod: "BM25",
      toolOverrides: {},
    };

    const originalTools = JSON.parse(JSON.stringify(sampleTools));
    await middleware.applyDeferLoading(sampleTools, config);

    // Original tools should be unchanged
    expect(sampleTools).toEqual(originalTools);
  });

  it("should handle empty tool list", async () => {
    const config: ResolvedDeferLoadingConfig = {
      deferLoadingEnabled: true,
      searchMethod: "BM25",
      toolOverrides: {},
    };

    const result = await middleware.applyDeferLoading([], config);

    expect(result).toEqual([]);
  });

  it("should handle tools with existing defer_loading property", async () => {
    const toolsWithDeferLoading: Tool[] = [
      { ...createTool("test_tool", "Test"), defer_loading: false },
    ];

    const config: ResolvedDeferLoadingConfig = {
      deferLoadingEnabled: true,
      searchMethod: "BM25",
      toolOverrides: {},
    };

    const result = await middleware.applyDeferLoading(
      toolsWithDeferLoading,
      config
    );

    expect(result[0].defer_loading).toBe(true); // Should override
  });
});

describe("DeferLoadingMiddleware - Cache Behavior", () => {
  let middleware: DeferLoadingMiddleware;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = new DeferLoadingMiddleware();
  });

  it("should cache resolved configuration", async () => {
    const namespaceUuid = "namespace-1";
    const endpointUuid = "endpoint-1";

    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: namespaceUuid,
      default_defer_loading: true,
      default_search_method: "BM25",
    } as any);

    vi.mocked(endpointsRepository.findByUuid).mockResolvedValue({
      uuid: endpointUuid,
      override_defer_loading: "INHERIT",
      override_search_method: "INHERIT",
    } as any);

    vi.mocked(
      namespaceMappingsRepository.findToolDeferLoadingOverrides
    ).mockResolvedValue({});

    // First call
    await middleware.getResolvedConfig(namespaceUuid, endpointUuid);

    // Second call
    await middleware.getResolvedConfig(namespaceUuid, endpointUuid);

    // Should only hit database once
    expect(namespacesRepository.findByUuid).toHaveBeenCalledTimes(1);
    expect(endpointsRepository.findByUuid).toHaveBeenCalledTimes(1);
  });

  it("should cache configurations per endpoint", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: "namespace-1",
      default_defer_loading: true,
      default_search_method: "BM25",
    } as any);

    vi.mocked(endpointsRepository.findByUuid).mockResolvedValue({
      uuid: "endpoint-1",
      override_defer_loading: "INHERIT",
      override_search_method: "INHERIT",
    } as any);

    vi.mocked(
      namespaceMappingsRepository.findToolDeferLoadingOverrides
    ).mockResolvedValue({});

    await middleware.getResolvedConfig("namespace-1", "endpoint-1");
    await middleware.getResolvedConfig("namespace-1", "endpoint-2");

    // Different endpoints should trigger separate lookups
    expect(endpointsRepository.findByUuid).toHaveBeenCalledTimes(2);
  });

  it("should support cache invalidation", async () => {
    const namespaceUuid = "namespace-1";
    const endpointUuid = "endpoint-1";

    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: namespaceUuid,
      default_defer_loading: true,
      default_search_method: "BM25",
    } as any);

    vi.mocked(endpointsRepository.findByUuid).mockResolvedValue({
      uuid: endpointUuid,
      override_defer_loading: "INHERIT",
      override_search_method: "INHERIT",
    } as any);

    vi.mocked(
      namespaceMappingsRepository.findToolDeferLoadingOverrides
    ).mockResolvedValue({});

    // First call
    await middleware.getResolvedConfig(namespaceUuid, endpointUuid);

    // Invalidate cache
    middleware.invalidateCache(endpointUuid);

    // Second call after invalidation
    await middleware.getResolvedConfig(namespaceUuid, endpointUuid);

    // Should hit database twice due to invalidation
    expect(namespacesRepository.findByUuid).toHaveBeenCalledTimes(2);
  });

  it("should support clearing entire cache", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: "namespace-1",
      default_defer_loading: true,
      default_search_method: "BM25",
    } as any);

    vi.mocked(endpointsRepository.findByUuid).mockResolvedValue({
      uuid: "endpoint-1",
      override_defer_loading: "INHERIT",
      override_search_method: "INHERIT",
    } as any);

    vi.mocked(
      namespaceMappingsRepository.findToolDeferLoadingOverrides
    ).mockResolvedValue({});

    await middleware.getResolvedConfig("namespace-1", "endpoint-1");
    await middleware.getResolvedConfig("namespace-1", "endpoint-2");

    // Clear all cache
    middleware.clearCache();

    await middleware.getResolvedConfig("namespace-1", "endpoint-1");

    // Should hit database again after clear
    expect(namespacesRepository.findByUuid).toHaveBeenCalledTimes(3);
  });

  it("should provide cache statistics", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: "namespace-1",
      default_defer_loading: true,
      default_search_method: "BM25",
    } as any);

    vi.mocked(endpointsRepository.findByUuid).mockResolvedValue({
      uuid: "endpoint-1",
      override_defer_loading: "INHERIT",
      override_search_method: "INHERIT",
    } as any);

    vi.mocked(
      namespaceMappingsRepository.findToolDeferLoadingOverrides
    ).mockResolvedValue({});

    await middleware.getResolvedConfig("namespace-1", "endpoint-1");
    await middleware.getResolvedConfig("namespace-1", "endpoint-2");

    const stats = middleware.getCacheStats();

    expect(stats.size).toBe(2);
    expect(stats.endpoints).toContain("endpoint-1");
    expect(stats.endpoints).toContain("endpoint-2");
  });
});

describe("DeferLoadingMiddleware - Error Handling", () => {
  let middleware: DeferLoadingMiddleware;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = new DeferLoadingMiddleware();
  });

  it("should handle database errors gracefully", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockRejectedValue(
      new Error("Database connection failed")
    );

    // Should not throw, should return fail-safe config
    const result = await middleware.getResolvedConfig(
      "namespace-1",
      "endpoint-1"
    );

    expect(result).toBeDefined();
    expect(result.deferLoadingEnabled).toBe(false); // Fail-safe: disabled
  });

  it("should handle missing namespace gracefully", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue(null);

    const result = await middleware.getResolvedConfig(
      "nonexistent",
      "endpoint-1"
    );

    expect(result.deferLoadingEnabled).toBe(false);
  });

  it("should handle missing endpoint gracefully", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: "namespace-1",
      default_defer_loading: true,
      default_search_method: "BM25",
    } as any);

    vi.mocked(endpointsRepository.findByUuid).mockResolvedValue(null);

    const result = await middleware.getResolvedConfig(
      "namespace-1",
      "nonexistent"
    );

    // Should fall back to namespace defaults
    expect(result.deferLoadingEnabled).toBe(true);
    expect(result.searchMethod).toBe("BM25");
  });

  it("should not break tool listing on middleware errors", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockRejectedValue(
      new Error("DB error")
    );

    const result = await middleware.process(
      sampleTools,
      "namespace-1",
      "endpoint-1"
    );

    // Should return original tools unmodified
    expect(result).toEqual(sampleTools);
  });

  it("should log errors without throwing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(namespacesRepository.findByUuid).mockRejectedValue(
      new Error("Test error")
    );

    await middleware.getResolvedConfig("namespace-1", "endpoint-1");

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("DeferLoadingMiddleware - Integration", () => {
  let middleware: DeferLoadingMiddleware;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = new DeferLoadingMiddleware();
  });

  it("should process tools end-to-end with default config", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: "namespace-1",
      default_defer_loading: true,
      default_search_method: "BM25",
    } as any);

    vi.mocked(endpointsRepository.findByUuid).mockResolvedValue({
      uuid: "endpoint-1",
      override_defer_loading: "INHERIT",
      override_search_method: "INHERIT",
    } as any);

    vi.mocked(
      namespaceMappingsRepository.findToolDeferLoadingOverrides
    ).mockResolvedValue({});

    const result = await middleware.process(
      sampleTools,
      "namespace-1",
      "endpoint-1"
    );

    // Should have defer_loading on all tools except search tool
    const fileReadTool = result.find((t) => t.name === "file__read_file");
    expect(fileReadTool?.defer_loading).toBe(true);

    const searchTool = result.find((t) => t.name === "metamcp_search_tools");
    expect(searchTool?.defer_loading).toBeUndefined();
  });

  it("should process tools with endpoint overrides", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: "namespace-1",
      default_defer_loading: false,
      default_search_method: "NONE",
    } as any);

    vi.mocked(endpointsRepository.findByUuid).mockResolvedValue({
      uuid: "endpoint-1",
      override_defer_loading: "ENABLED",
      override_search_method: "REGEX",
    } as any);

    vi.mocked(
      namespaceMappingsRepository.findToolDeferLoadingOverrides
    ).mockResolvedValue({});

    const result = await middleware.process(
      sampleTools,
      "namespace-1",
      "endpoint-1"
    );

    // Endpoint override should enable defer_loading
    const fileReadTool = result.find((t) => t.name === "file__read_file");
    expect(fileReadTool?.defer_loading).toBe(true);
  });

  it("should process tools with per-tool overrides", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: "namespace-1",
      default_defer_loading: true,
      default_search_method: "BM25",
    } as any);

    vi.mocked(endpointsRepository.findByUuid).mockResolvedValue({
      uuid: "endpoint-1",
      override_defer_loading: "INHERIT",
      override_search_method: "INHERIT",
    } as any);

    vi.mocked(
      namespaceMappingsRepository.findToolDeferLoadingOverrides
    ).mockResolvedValue({
      "file__read_file": false,
      "db__query": true,
    });

    const result = await middleware.process(
      sampleTools,
      "namespace-1",
      "endpoint-1"
    );

    const readFileTool = result.find((t) => t.name === "file__read_file");
    expect(readFileTool?.defer_loading).toBeUndefined(); // Override to false

    const dbQueryTool = result.find((t) => t.name === "db__query");
    expect(dbQueryTool?.defer_loading).toBe(true);

    const writeFileTool = result.find((t) => t.name === "file__write_file");
    expect(writeFileTool?.defer_loading).toBe(true); // Default
  });

  it("should handle rapid successive calls efficiently", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: "namespace-1",
      default_defer_loading: true,
      default_search_method: "BM25",
    } as any);

    vi.mocked(endpointsRepository.findByUuid).mockResolvedValue({
      uuid: "endpoint-1",
      override_defer_loading: "INHERIT",
      override_search_method: "INHERIT",
    } as any);

    vi.mocked(
      namespaceMappingsRepository.findToolDeferLoadingOverrides
    ).mockResolvedValue({});

    // Simulate 10 rapid calls
    const promises = Array.from({ length: 10 }, () =>
      middleware.process(sampleTools, "namespace-1", "endpoint-1")
    );

    const results = await Promise.all(promises);

    // All results should be consistent
    expect(results).toHaveLength(10);
    results.forEach((result) => {
      const fileReadTool = result.find((t) => t.name === "file__read_file");
      expect(fileReadTool?.defer_loading).toBe(true);
    });

    // Should only hit database once due to caching
    expect(namespacesRepository.findByUuid).toHaveBeenCalledTimes(1);
  });
});

describe("DeferLoadingMiddleware - Performance", () => {
  let middleware: DeferLoadingMiddleware;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = new DeferLoadingMiddleware();
  });

  it("should complete processing within 10ms with warm cache", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: "namespace-1",
      default_defer_loading: true,
      default_search_method: "BM25",
    } as any);

    vi.mocked(endpointsRepository.findByUuid).mockResolvedValue({
      uuid: "endpoint-1",
      override_defer_loading: "INHERIT",
      override_search_method: "INHERIT",
    } as any);

    vi.mocked(
      namespaceMappingsRepository.findToolDeferLoadingOverrides
    ).mockResolvedValue({});

    // Warm up cache
    await middleware.process(sampleTools, "namespace-1", "endpoint-1");

    // Measure performance with warm cache
    const start = performance.now();
    await middleware.process(sampleTools, "namespace-1", "endpoint-1");
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(10);
  });

  it("should handle large tool lists efficiently", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: "namespace-1",
      default_defer_loading: true,
      default_search_method: "BM25",
    } as any);

    vi.mocked(endpointsRepository.findByUuid).mockResolvedValue({
      uuid: "endpoint-1",
      override_defer_loading: "INHERIT",
      override_search_method: "INHERIT",
    } as any);

    vi.mocked(
      namespaceMappingsRepository.findToolDeferLoadingOverrides
    ).mockResolvedValue({});

    // Create 1000 tools
    const largeToolList = Array.from({ length: 1000 }, (_, i) =>
      createTool(`tool_${i}`, `Tool ${i}`)
    );

    // Warm up cache
    await middleware.process(largeToolList, "namespace-1", "endpoint-1");

    const start = performance.now();
    const result = await middleware.process(
      largeToolList,
      "namespace-1",
      "endpoint-1"
    );
    const duration = performance.now() - start;

    expect(result).toHaveLength(1000);
    expect(duration).toBeLessThan(50); // Should be fast even with 1000 tools
  });
});
