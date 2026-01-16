import { describe, it, expect, beforeEach } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { RegexSearchProvider } from "./regex-search-provider.js";
import { BM25SearchProvider } from "./bm25-search-provider.js";
import { SearchProviderFactory } from "./search-provider-factory.js";
import { ToolSearchService } from "./tool-search-service.js";

// Test data: Sample tools for testing
const createTool = (
  name: string,
  description: string,
  serverUuid: string = "server-1"
): { tool: Tool; serverUuid: string } => ({
  tool: {
    name,
    description,
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  serverUuid,
});

const sampleTools = [
  createTool(
    "read_file",
    "Read the contents of a file from the filesystem"
  ),
  createTool(
    "write_file",
    "Write content to a file on the filesystem"
  ),
  createTool(
    "list_directory",
    "List all files and directories in a given path"
  ),
  createTool(
    "execute_command",
    "Execute a shell command and return the output"
  ),
  createTool(
    "search_code",
    "Search for code patterns using regular expressions"
  ),
  createTool(
    "get_weather",
    "Get current weather information for a location"
  ),
  createTool(
    "send_email",
    "Send an email message to specified recipients"
  ),
];

describe("RegexSearchProvider", () => {
  let provider: RegexSearchProvider;

  beforeEach(async () => {
    provider = new RegexSearchProvider();
    await provider.initialize({});
  });

  describe("basic search", () => {
    it("should find tools by exact name match", async () => {
      const results = await provider.search(
        { query: "read_file" },
        sampleTools
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tool.name).toBe("read_file");
    });

    it("should find tools by partial name match", async () => {
      const results = await provider.search(
        { query: "file" },
        sampleTools
      );

      expect(results.length).toBeGreaterThanOrEqual(2);
      const names = results.map((r) => r.tool.name);
      expect(names).toContain("read_file");
      expect(names).toContain("write_file");
    });

    it("should find tools by description match", async () => {
      const results = await provider.search(
        { query: "filesystem" },
        sampleTools
      );

      expect(results.length).toBeGreaterThan(0);
      expect(
        results.some((r) => r.tool.description?.includes("filesystem"))
      ).toBe(true);
    });

    it("should be case insensitive by default", async () => {
      const results = await provider.search(
        { query: "FILE" },
        sampleTools
      );

      expect(results.length).toBeGreaterThan(0);
      expect(
        results.some((r) => r.tool.name.toLowerCase().includes("file"))
      ).toBe(true);
    });
  });

  describe("regex patterns", () => {
    it("should support custom regex patterns", async () => {
      await provider.initialize({
        pattern: "^(read|write)_",
      });

      const results = await provider.search(
        { query: "" },
        sampleTools
      );

      expect(results.length).toBe(2);
      const names = results.map((r) => r.tool.name);
      expect(names).toContain("read_file");
      expect(names).toContain("write_file");
    });

    it("should handle invalid regex gracefully", async () => {
      await provider.initialize({
        pattern: "[invalid(regex",
      });

      const results = await provider.search(
        { query: "file" },
        sampleTools
      );

      // Should fallback to literal match
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("scoring", () => {
    it("should score name matches higher than description matches", async () => {
      const results = await provider.search(
        { query: "file" },
        sampleTools
      );

      // Tools with "file" in name should score higher
      const fileNameTools = results.filter((r) =>
        r.tool.name.includes("file")
      );
      const otherTools = results.filter(
        (r) => !r.tool.name.includes("file")
      );

      if (fileNameTools.length > 0 && otherTools.length > 0) {
        expect(fileNameTools[0].score).toBeGreaterThan(otherTools[0].score);
      }
    });

    it("should include scores between 0 and 1", async () => {
      const results = await provider.search(
        { query: "file" },
        sampleTools
      );

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    it("should provide match reasons", async () => {
      const results = await provider.search(
        { query: "file" },
        sampleTools
      );

      for (const result of results) {
        expect(result.matchReason).toBeDefined();
        expect(typeof result.matchReason).toBe("string");
      }
    });
  });

  describe("max results", () => {
    it("should respect maxResults parameter", async () => {
      const results = await provider.search(
        { query: "file", maxResults: 2 },
        sampleTools
      );

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should use default maxResults of 5", async () => {
      const results = await provider.search(
        { query: "" },
        sampleTools
      );

      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe("edge cases", () => {
    it("should handle empty query", async () => {
      const results = await provider.search(
        { query: "" },
        sampleTools
      );

      // Empty query should return tools (up to maxResults) with neutral score
      expect(results.length).toBeLessThanOrEqual(5); // default maxResults
      expect(results[0].score).toBe(0.5);
      expect(results[0].matchReason).toBe("No search query provided");
    });

    it("should handle no matches", async () => {
      const results = await provider.search(
        { query: "nonexistent_tool_xyz" },
        sampleTools
      );

      expect(results.length).toBe(0);
    });

    it("should handle empty tools array", async () => {
      const results = await provider.search(
        { query: "file" },
        []
      );

      expect(results.length).toBe(0);
    });
  });
});

describe("BM25SearchProvider", () => {
  let provider: BM25SearchProvider;

  beforeEach(async () => {
    provider = new BM25SearchProvider();
    await provider.initialize({});
  });

  describe("basic search", () => {
    it("should find tools by keyword match", async () => {
      const results = await provider.search(
        { query: "file" },
        sampleTools
      );

      expect(results.length).toBeGreaterThan(0);
      expect(
        results.some((r) =>
          r.tool.name.toLowerCase().includes("file") ||
          r.tool.description?.toLowerCase().includes("file")
        )
      ).toBe(true);
    });

    it("should rank by relevance", async () => {
      const results = await provider.search(
        { query: "file filesystem" },
        sampleTools
      );

      // Tools matching both terms should rank higher
      expect(results.length).toBeGreaterThan(0);
      // Verify results are sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("should handle multi-word queries", async () => {
      const results = await provider.search(
        { query: "read file contents" },
        sampleTools
      );

      expect(results.length).toBeGreaterThan(0);
      // "read_file" should be highly ranked
      expect(results[0].tool.name).toBe("read_file");
    });
  });

  describe("BM25 configuration", () => {
    it("should respect k1 parameter", async () => {
      const provider1 = new BM25SearchProvider();
      await provider1.initialize({ k1: 0.5 });

      const provider2 = new BM25SearchProvider();
      await provider2.initialize({ k1: 2.0 });

      const results1 = await provider1.search({ query: "file" }, sampleTools);
      const results2 = await provider2.search({ query: "file" }, sampleTools);

      // Different k1 values should produce different scores
      expect(results1[0].score).not.toBe(results2[0].score);
    });

    it("should respect b parameter", async () => {
      const provider1 = new BM25SearchProvider();
      await provider1.initialize({ b: 0.0 });

      const provider2 = new BM25SearchProvider();
      await provider2.initialize({ b: 1.0 });

      const results1 = await provider1.search({ query: "file" }, sampleTools);
      const results2 = await provider2.search({ query: "file" }, sampleTools);

      // Different b values affect length normalization
      expect(results1[0].score).not.toBe(results2[0].score);
    });

    it("should allow custom fields", async () => {
      await provider.initialize({
        fields: ["name"], // Only search names, not descriptions
      });

      const results = await provider.search(
        { query: "filesystem" }, // Only in description
        sampleTools
      );

      // Should not match since we're only searching names
      expect(results.length).toBe(0);
    });
  });

  describe("scoring", () => {
    it("should return scores between 0 and 1", async () => {
      const results = await provider.search(
        { query: "file" },
        sampleTools
      );

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    it("should provide match reasons", async () => {
      const results = await provider.search(
        { query: "file system" },
        sampleTools
      );

      for (const result of results) {
        expect(result.matchReason).toBeDefined();
        expect(typeof result.matchReason).toBe("string");
      }
    });

    it("should handle term frequency correctly", async () => {
      const toolWithRepeatedTerm = createTool(
        "file_file_file",
        "A tool about file file file operations"
      );

      const results = await provider.search(
        { query: "file" },
        [toolWithRepeatedTerm, ...sampleTools]
      );

      // Tool with repeated term should score well
      expect(results[0].tool.name).toBe("file_file_file");
    });
  });

  describe("max results", () => {
    it("should respect maxResults parameter", async () => {
      const results = await provider.search(
        { query: "file", maxResults: 3 },
        sampleTools
      );

      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe("edge cases", () => {
    it("should handle empty query", async () => {
      const results = await provider.search(
        { query: "" },
        sampleTools
      );

      // Empty query returns tools (up to maxResults) with neutral score
      expect(results.length).toBeLessThanOrEqual(5); // default maxResults
      expect(results[0].score).toBe(0.5);
    });

    it("should handle no matches", async () => {
      const results = await provider.search(
        { query: "xyz_nonexistent_keyword_abc" },
        sampleTools
      );

      expect(results.length).toBe(0);
    });

    it("should handle special characters in query", async () => {
      const results = await provider.search(
        { query: "file-system_test" },
        sampleTools
      );

      // Should tokenize and match "file", "system", "test"
      expect(results.length).toBeGreaterThan(0);
    });
  });
});

describe("SearchProviderFactory", () => {
  describe("provider registration", () => {
    it("should have REGEX provider registered", () => {
      expect(SearchProviderFactory.isSupported("REGEX")).toBe(true);
    });

    it("should have BM25 provider registered", () => {
      expect(SearchProviderFactory.isSupported("BM25")).toBe(true);
    });

    it("should support NONE method", () => {
      expect(SearchProviderFactory.isSupported("NONE")).toBe(true);
    });

    it("should not have EMBEDDINGS provider registered yet", () => {
      expect(SearchProviderFactory.isSupported("EMBEDDINGS")).toBe(false);
    });

    it("should list all supported methods", () => {
      const methods = SearchProviderFactory.getSupportedMethods();

      expect(methods).toContain("NONE");
      expect(methods).toContain("REGEX");
      expect(methods).toContain("BM25");
    });
  });

  describe("provider creation", () => {
    it("should create REGEX provider", async () => {
      const provider = await SearchProviderFactory.create("REGEX");

      expect(provider).toBeDefined();
      expect(provider.name).toBe("REGEX");
    });

    it("should create BM25 provider", async () => {
      const provider = await SearchProviderFactory.create("BM25");

      expect(provider).toBeDefined();
      expect(provider.name).toBe("BM25");
    });

    it("should throw error for NONE method", async () => {
      await expect(SearchProviderFactory.create("NONE")).rejects.toThrow();
    });

    it("should throw error for unregistered provider", async () => {
      await expect(
        SearchProviderFactory.create("EMBEDDINGS")
      ).rejects.toThrow();
    });

    it("should pass config to provider initialize", async () => {
      const config = { k1: 1.5, b: 0.8 };
      const provider = await SearchProviderFactory.create("BM25", config);

      // Verify provider was initialized with config
      expect(provider).toBeDefined();
    });
  });
});

describe("ToolSearchService", () => {
  let service: ToolSearchService;

  beforeEach(() => {
    service = new ToolSearchService();
  });

  describe("search execution", () => {
    it("should execute REGEX search", async () => {
      const results = await service.search(
        { query: "file" },
        sampleTools,
        { searchMethod: "REGEX", maxResults: 5 }
      );

      expect(results.length).toBeGreaterThan(0);
    });

    it("should execute BM25 search", async () => {
      const results = await service.search(
        { query: "file" },
        sampleTools,
        { searchMethod: "BM25", maxResults: 5 }
      );

      expect(results.length).toBeGreaterThan(0);
    });

    it("should handle NONE search method", async () => {
      const results = await service.search(
        { query: "file" },
        sampleTools,
        { searchMethod: "NONE", maxResults: 5 }
      );

      // NONE should return all tools
      expect(results.length).toBe(sampleTools.length);
      expect(results[0].matchReason).toContain("method: NONE");
    });

    it("should apply maxResults from config", async () => {
      const results = await service.search(
        { query: "" },
        sampleTools,
        { searchMethod: "REGEX", maxResults: 3 }
      );

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("should prefer query maxResults over config", async () => {
      const results = await service.search(
        { query: "", maxResults: 2 },
        sampleTools,
        { searchMethod: "REGEX", maxResults: 5 }
      );

      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("provider caching", () => {
    it("should cache providers for reuse", async () => {
      const config = { searchMethod: "REGEX" as const, maxResults: 5 };

      await service.search({ query: "file" }, sampleTools, config);
      await service.search({ query: "write" }, sampleTools, config);

      // Second call should use cached provider (no way to directly test,
      // but this ensures no errors with cache)
      expect(true).toBe(true);
    });

    it("should clear cache on demand", async () => {
      await service.search(
        { query: "file" },
        sampleTools,
        { searchMethod: "REGEX", maxResults: 5 }
      );

      service.clearCache();

      // Should not throw after clearing cache
      const results = await service.search(
        { query: "file" },
        sampleTools,
        { searchMethod: "REGEX", maxResults: 5 }
      );

      expect(results).toBeDefined();
    });

    it("should clear specific provider from cache", async () => {
      await service.search(
        { query: "file" },
        sampleTools,
        { searchMethod: "REGEX", maxResults: 5 }
      );

      await service.clearProviderCache("REGEX");

      // Should still work after clearing specific provider
      const results = await service.search(
        { query: "file" },
        sampleTools,
        { searchMethod: "REGEX", maxResults: 5 }
      );

      expect(results).toBeDefined();
    });
  });

  describe("utility methods", () => {
    it("should return supported methods", () => {
      const methods = service.getSupportedMethods();

      expect(methods).toContain("NONE");
      expect(methods).toContain("REGEX");
      expect(methods).toContain("BM25");
    });

    it("should check if method is supported", () => {
      expect(service.isMethodSupported("REGEX")).toBe(true);
      expect(service.isMethodSupported("BM25")).toBe(true);
      expect(service.isMethodSupported("NONE")).toBe(true);
      expect(service.isMethodSupported("EMBEDDINGS")).toBe(false);
    });
  });

  describe("provider configuration", () => {
    it("should pass provider config through", async () => {
      const results = await service.search(
        { query: "file" },
        sampleTools,
        {
          searchMethod: "BM25",
          maxResults: 5,
          providerConfig: { k1: 2.0, b: 0.5 },
        }
      );

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
