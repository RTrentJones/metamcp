import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../db/index";
import {
  namespacesTable,
  mcpServersTable,
  toolsTable,
  namespaceToolMappingsTable,
  toolSearchConfigTable,
} from "../db/schema";
import { eq } from "drizzle-orm";
import { toolSearchConfigImplementations } from "./tool-search-config.impl";
import { namespacesImplementations } from "./namespaces.impl";

describe("Tool Search tRPC Implementations - Integration Tests", () => {
  // Test data
  let testUserId: string;
  let testNamespaceUuid: string;
  let testServerUuid: string;
  let testToolUuid: string;

  beforeEach(async () => {
    testUserId = "test-user-trpc-123";

    // Create a test MCP server
    const [server] = await db
      .insert(mcpServersTable)
      .values({
        name: "test-server-trpc",
        type: "STDIO",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
        env: {},
        user_id: testUserId,
      })
      .returning();
    testServerUuid = server.uuid;

    // Create a test tool
    const [tool] = await db
      .insert(toolsTable)
      .values({
        name: "test_tool",
        description: "A test tool",
        toolSchema: { type: "object" },
        mcp_server_uuid: testServerUuid,
      })
      .returning();
    testToolUuid = tool.uuid;

    // Create test namespace
    const [namespace] = await db
      .insert(namespacesTable)
      .values({
        name: "test-namespace-trpc",
        description: "Test namespace",
        user_id: testUserId,
        default_defer_loading: false,
        default_search_method: "NONE",
      })
      .returning();
    testNamespaceUuid = namespace.uuid;

    // Create tool mapping
    await db.insert(namespaceToolMappingsTable).values({
      namespace_uuid: testNamespaceUuid,
      tool_uuid: testToolUuid,
      mcp_server_uuid: testServerUuid,
      status: "ACTIVE",
      defer_loading: "INHERIT",
    });
  });

  afterEach(async () => {
    // Clean up in reverse order of dependencies
    await db
      .delete(namespaceToolMappingsTable)
      .where(eq(namespaceToolMappingsTable.namespace_uuid, testNamespaceUuid));
    await db
      .delete(toolSearchConfigTable)
      .where(eq(toolSearchConfigTable.namespace_uuid, testNamespaceUuid));
    await db
      .delete(namespacesTable)
      .where(eq(namespacesTable.uuid, testNamespaceUuid));
    await db.delete(toolsTable).where(eq(toolsTable.uuid, testToolUuid));
    await db
      .delete(mcpServersTable)
      .where(eq(mcpServersTable.uuid, testServerUuid));
  });

  describe("ToolSearchConfigImplementations", () => {
    describe("get", () => {
      it("should return null when config does not exist", async () => {
        const result = await toolSearchConfigImplementations.get({
          namespaceUuid: testNamespaceUuid,
        });

        expect(result.success).toBe(true);
        expect(result.data).toBeUndefined();
      });

      it("should return existing config", async () => {
        // Create config
        await db.insert(toolSearchConfigTable).values({
          namespace_uuid: testNamespaceUuid,
          max_results: 10,
          provider_config: { k1: 1.5, b: 0.75 },
        });

        const result = await toolSearchConfigImplementations.get({
          namespaceUuid: testNamespaceUuid,
        });

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data?.namespace_uuid).toBe(testNamespaceUuid);
        expect(result.data?.max_results).toBe(10);
        expect(result.data?.provider_config).toEqual({ k1: 1.5, b: 0.75 });
      });

      it("should handle errors gracefully", async () => {
        const result = await toolSearchConfigImplementations.get({
          namespaceUuid: "invalid-uuid",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBeDefined();
      });
    });

    describe("upsert", () => {
      it("should create new config when none exists", async () => {
        const result = await toolSearchConfigImplementations.upsert({
          namespaceUuid: testNamespaceUuid,
          maxResults: 15,
          providerConfig: { k1: 2.0 },
        });

        expect(result.success).toBe(true);
        expect(result.data.namespace_uuid).toBe(testNamespaceUuid);
        expect(result.data.max_results).toBe(15);
        expect(result.data.provider_config).toEqual({ k1: 2.0 });

        // Verify in database
        const [dbConfig] = await db
          .select()
          .from(toolSearchConfigTable)
          .where(eq(toolSearchConfigTable.namespace_uuid, testNamespaceUuid));

        expect(dbConfig).toBeDefined();
        expect(dbConfig.max_results).toBe(15);
      });

      it("should update existing config", async () => {
        // Create initial config
        await db.insert(toolSearchConfigTable).values({
          namespace_uuid: testNamespaceUuid,
          max_results: 5,
          provider_config: { k1: 1.0 },
        });

        // Update via upsert
        const result = await toolSearchConfigImplementations.upsert({
          namespaceUuid: testNamespaceUuid,
          maxResults: 20,
          providerConfig: { k1: 3.0, b: 0.5 },
        });

        expect(result.success).toBe(true);
        expect(result.data.max_results).toBe(20);
        expect(result.data.provider_config).toEqual({ k1: 3.0, b: 0.5 });

        // Verify only one config exists
        const configs = await db
          .select()
          .from(toolSearchConfigTable)
          .where(eq(toolSearchConfigTable.namespace_uuid, testNamespaceUuid));

        expect(configs.length).toBe(1);
        expect(configs[0].max_results).toBe(20);
      });

      it("should handle null provider_config", async () => {
        const result = await toolSearchConfigImplementations.upsert({
          namespaceUuid: testNamespaceUuid,
          maxResults: 10,
          providerConfig: null,
        });

        expect(result.success).toBe(true);
        expect(result.data.provider_config).toBeNull();
      });

      it("should enforce foreign key constraint", async () => {
        await expect(
          toolSearchConfigImplementations.upsert({
            namespaceUuid: "nonexistent-uuid-123",
            maxResults: 10,
            providerConfig: {},
          })
        ).rejects.toThrow();
      });
    });
  });

  describe("NamespacesImplementations - updateToolDeferLoading", () => {
    it("should update tool defer_loading to ENABLED", async () => {
      const result = await namespacesImplementations.updateToolDeferLoading(
        {
          namespaceUuid: testNamespaceUuid,
          toolUuid: testToolUuid,
          serverUuid: testServerUuid,
          deferLoading: "ENABLED",
        },
        testUserId
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("Tool defer_loading updated successfully");

      // Verify in database
      const [mapping] = await db
        .select()
        .from(namespaceToolMappingsTable)
        .where(eq(namespaceToolMappingsTable.tool_uuid, testToolUuid));

      expect(mapping.defer_loading).toBe("ENABLED");
    });

    it("should update tool defer_loading to DISABLED", async () => {
      const result = await namespacesImplementations.updateToolDeferLoading(
        {
          namespaceUuid: testNamespaceUuid,
          toolUuid: testToolUuid,
          serverUuid: testServerUuid,
          deferLoading: "DISABLED",
        },
        testUserId
      );

      expect(result.success).toBe(true);

      const [mapping] = await db
        .select()
        .from(namespaceToolMappingsTable)
        .where(eq(namespaceToolMappingsTable.tool_uuid, testToolUuid));

      expect(mapping.defer_loading).toBe("DISABLED");
    });

    it("should update tool defer_loading back to INHERIT", async () => {
      // First set to ENABLED
      await db
        .update(namespaceToolMappingsTable)
        .set({ defer_loading: "ENABLED" })
        .where(eq(namespaceToolMappingsTable.tool_uuid, testToolUuid));

      // Then update to INHERIT
      const result = await namespacesImplementations.updateToolDeferLoading(
        {
          namespaceUuid: testNamespaceUuid,
          toolUuid: testToolUuid,
          serverUuid: testServerUuid,
          deferLoading: "INHERIT",
        },
        testUserId
      );

      expect(result.success).toBe(true);

      const [mapping] = await db
        .select()
        .from(namespaceToolMappingsTable)
        .where(eq(namespaceToolMappingsTable.tool_uuid, testToolUuid));

      expect(mapping.defer_loading).toBe("INHERIT");
    });

    it("should return error for nonexistent namespace", async () => {
      const result = await namespacesImplementations.updateToolDeferLoading(
        {
          namespaceUuid: "nonexistent-uuid",
          toolUuid: testToolUuid,
          serverUuid: testServerUuid,
          deferLoading: "ENABLED",
        },
        testUserId
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe("Namespace not found");
    });

    it("should return error for unauthorized user", async () => {
      const result = await namespacesImplementations.updateToolDeferLoading(
        {
          namespaceUuid: testNamespaceUuid,
          toolUuid: testToolUuid,
          serverUuid: testServerUuid,
          deferLoading: "ENABLED",
        },
        "different-user-id"
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Access denied");
    });

    it("should allow public namespace update by any user", async () => {
      // Create public namespace (user_id = null)
      const [publicNamespace] = await db
        .insert(namespacesTable)
        .values({
          name: "public-namespace",
          user_id: null,
        })
        .returning();

      // Create tool mapping for public namespace
      await db.insert(namespaceToolMappingsTable).values({
        namespace_uuid: publicNamespace.uuid,
        tool_uuid: testToolUuid,
        mcp_server_uuid: testServerUuid,
        status: "ACTIVE",
        defer_loading: "INHERIT",
      });

      const result = await namespacesImplementations.updateToolDeferLoading(
        {
          namespaceUuid: publicNamespace.uuid,
          toolUuid: testToolUuid,
          serverUuid: testServerUuid,
          deferLoading: "ENABLED",
        },
        "any-user-id"
      );

      expect(result.success).toBe(true);

      // Clean up
      await db
        .delete(namespaceToolMappingsTable)
        .where(
          eq(namespaceToolMappingsTable.namespace_uuid, publicNamespace.uuid)
        );
      await db
        .delete(namespacesTable)
        .where(eq(namespacesTable.uuid, publicNamespace.uuid));
    });

    it("should return error for nonexistent tool mapping", async () => {
      const result = await namespacesImplementations.updateToolDeferLoading(
        {
          namespaceUuid: testNamespaceUuid,
          toolUuid: "nonexistent-tool-uuid",
          serverUuid: testServerUuid,
          deferLoading: "ENABLED",
        },
        testUserId
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe("Tool not found in namespace");
    });
  });

  describe("Integration: Config and Defer Loading Together", () => {
    it("should manage both config and per-tool defer_loading independently", async () => {
      // Create namespace-level config
      const configResult = await toolSearchConfigImplementations.upsert({
        namespaceUuid: testNamespaceUuid,
        maxResults: 10,
        providerConfig: { k1: 1.5 },
      });
      expect(configResult.success).toBe(true);

      // Update tool-level defer_loading
      const deferResult =
        await namespacesImplementations.updateToolDeferLoading(
          {
            namespaceUuid: testNamespaceUuid,
            toolUuid: testToolUuid,
            serverUuid: testServerUuid,
            deferLoading: "ENABLED",
          },
          testUserId
        );
      expect(deferResult.success).toBe(true);

      // Verify both are set correctly
      const config = await toolSearchConfigImplementations.get({
        namespaceUuid: testNamespaceUuid,
      });
      expect(config.data?.max_results).toBe(10);

      const [mapping] = await db
        .select()
        .from(namespaceToolMappingsTable)
        .where(eq(namespaceToolMappingsTable.tool_uuid, testToolUuid));
      expect(mapping.defer_loading).toBe("ENABLED");
    });
  });

  describe("Namespace Defaults - Frontend Integration", () => {
    it("should update namespace with default_defer_loading and default_search_method", async () => {
      // Update namespace with defaults
      const updateResult = await namespacesImplementations.update(
        {
          uuid: testNamespaceUuid,
          name: "test-namespace-trpc",
          description: "Test namespace with defaults",
          default_defer_loading: true,
          default_search_method: "BM25",
        },
        testUserId
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.default_defer_loading).toBe(true);
      expect(updateResult.data?.default_search_method).toBe("BM25");

      // Verify in database
      const [dbNamespace] = await db
        .select()
        .from(namespacesTable)
        .where(eq(namespacesTable.uuid, testNamespaceUuid));

      expect(dbNamespace.default_defer_loading).toBe(true);
      expect(dbNamespace.default_search_method).toBe("BM25");
    });

    it("should handle null/undefined default values", async () => {
      const updateResult = await namespacesImplementations.update(
        {
          uuid: testNamespaceUuid,
          name: "test-namespace-trpc",
          default_defer_loading: false,
          default_search_method: "NONE",
        },
        testUserId
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.default_defer_loading).toBe(false);
      expect(updateResult.data?.default_search_method).toBe("NONE");
    });

    it("should accept all valid search methods", async () => {
      const methods = ["NONE", "REGEX", "BM25", "EMBEDDINGS"] as const;

      for (const method of methods) {
        const updateResult = await namespacesImplementations.update(
          {
            uuid: testNamespaceUuid,
            name: "test-namespace-trpc",
            default_search_method: method,
          },
          testUserId
        );

        expect(updateResult.success).toBe(true);
        expect(updateResult.data?.default_search_method).toBe(method);
      }
    });
  });
});
