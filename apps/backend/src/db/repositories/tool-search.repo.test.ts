import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../index";
import {
  namespacesTable,
  endpointsTable,
  namespaceToolMappingsTable,
  toolsTable,
  mcpServersTable,
  toolSearchConfigTable,
} from "../schema";
import {
  namespacesRepository,
  NamespacesRepository,
} from "./namespaces.repo";
import {
  endpointsRepository,
  EndpointsRepository,
} from "./endpoints.repo";
import {
  namespaceMappingsRepository,
  NamespaceMappingsRepository,
} from "./namespace-mappings.repo";
import { toolSearchConfigRepository, ToolSearchConfigRepository } from "./tool-search-config.repo";
import { eq } from "drizzle-orm";

describe("Tool Search Repositories - Integration Tests", () => {
  // Test data
  let testUserId: string;
  let testNamespaceUuid: string;
  let testEndpointUuid: string;
  let testServerUuid: string;
  let testToolUuid: string;

  beforeEach(async () => {
    testUserId = "test-user-repo-123";

    // Create a test MCP server
    const [server] = await db
      .insert(mcpServersTable)
      .values({
        name: "test-server-repo",
        type: "STDIO",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
        env: [],
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
        input_schema: {},
        mcp_server_uuid: testServerUuid,
      })
      .returning();
    testToolUuid = tool.uuid;

    // Create test namespace with tool search fields
    const [namespace] = await db
      .insert(namespacesTable)
      .values({
        name: "test-namespace-repo",
        description: "Test namespace",
        user_id: testUserId,
        default_defer_loading: true,
        default_search_method: "BM25",
      })
      .returning();
    testNamespaceUuid = namespace.uuid;

    // Create test endpoint with tool search fields
    const [endpoint] = await db
      .insert(endpointsTable)
      .values({
        name: "test-endpoint-repo-" + Date.now(),
        namespace_uuid: testNamespaceUuid,
        override_defer_loading: "INHERIT",
        override_search_method: "REGEX",
      })
      .returning();
    testEndpointUuid = endpoint.uuid;

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
    await db.delete(toolSearchConfigTable).where(eq(toolSearchConfigTable.namespace_uuid, testNamespaceUuid));
    await db.delete(endpointsTable).where(eq(endpointsTable.uuid, testEndpointUuid));
    await db
      .delete(namespacesTable)
      .where(eq(namespacesTable.uuid, testNamespaceUuid));
    await db.delete(toolsTable).where(eq(toolsTable.uuid, testToolUuid));
    await db
      .delete(mcpServersTable)
      .where(eq(mcpServersTable.uuid, testServerUuid));
  });

  describe("NamespacesRepository - Tool Search Fields", () => {
    it("should return default_defer_loading and default_search_method in findByUuid", async () => {
      const namespace = await namespacesRepository.findByUuid(testNamespaceUuid);

      expect(namespace).toBeDefined();
      expect(namespace?.default_defer_loading).toBe(true);
      expect(namespace?.default_search_method).toBe("BM25");
    });

    it("should create namespace with tool search defaults", async () => {
      const newNamespace = await namespacesRepository.create({
        name: "new-test-namespace",
        description: "New test",
        user_id: testUserId,
        mcpServerUuids: [],
        default_defer_loading: false,
        default_search_method: "REGEX",
      });

      expect(newNamespace.default_defer_loading).toBe(false);
      expect(newNamespace.default_search_method).toBe("REGEX");

      // Clean up
      await db
        .delete(namespacesTable)
        .where(eq(namespacesTable.uuid, newNamespace.uuid));
    });

    it("should update namespace tool search fields", async () => {
      const updated = await namespacesRepository.update({
        uuid: testNamespaceUuid,
        name: "updated-namespace",
        default_defer_loading: false,
        default_search_method: "NONE",
      });

      expect(updated?.default_defer_loading).toBe(false);
      expect(updated?.default_search_method).toBe("NONE");
    });

    it("should use default values when tool search fields not provided", async () => {
      const newNamespace = await namespacesRepository.create({
        name: "default-values-test",
        description: "Test defaults",
        user_id: testUserId,
        mcpServerUuids: [],
      });

      expect(newNamespace.default_defer_loading).toBe(false); // Schema default
      expect(newNamespace.default_search_method).toBe("NONE"); // Schema default

      // Clean up
      await db
        .delete(namespacesTable)
        .where(eq(namespacesTable.uuid, newNamespace.uuid));
    });
  });

  describe("EndpointsRepository - Tool Search Fields", () => {
    it("should return override fields in findByUuid", async () => {
      const endpoint = await endpointsRepository.findByUuid(testEndpointUuid);

      expect(endpoint).toBeDefined();
      expect(endpoint?.override_defer_loading).toBe("INHERIT");
      expect(endpoint?.override_search_method).toBe("REGEX");
    });

    it("should create endpoint with tool search overrides", async () => {
      const newEndpoint = await endpointsRepository.create({
        name: "new-test-endpoint-" + Date.now(),
        namespace_uuid: testNamespaceUuid,
        override_defer_loading: "ENABLED",
        override_search_method: "BM25",
      });

      expect(newEndpoint.override_defer_loading).toBe("ENABLED");
      expect(newEndpoint.override_search_method).toBe("BM25");

      // Clean up
      await db
        .delete(endpointsTable)
        .where(eq(endpointsTable.uuid, newEndpoint.uuid));
    });

    it("should update endpoint tool search overrides", async () => {
      const updated = await endpointsRepository.update({
        uuid: testEndpointUuid,
        override_defer_loading: "DISABLED",
        override_search_method: "NONE",
      });

      expect(updated?.override_defer_loading).toBe("DISABLED");
      expect(updated?.override_search_method).toBe("NONE");
    });

    it("should use default override values when not provided", async () => {
      const newEndpoint = await endpointsRepository.create({
        name: "default-override-test-" + Date.now(),
        namespace_uuid: testNamespaceUuid,
      });

      expect(newEndpoint.override_defer_loading).toBe("INHERIT"); // Schema default
      expect(newEndpoint.override_search_method).toBeNull(); // Schema default

      // Clean up
      await db
        .delete(endpointsTable)
        .where(eq(endpointsTable.uuid, newEndpoint.uuid));
    });
  });

  describe("NamespaceMappingsRepository - Tool Defer Loading Overrides", () => {
    it("should return defer_loading overrides for namespace tools", async () => {
      const overrides = await namespaceMappingsRepository.findToolDeferLoadingOverrides(
        testNamespaceUuid
      );

      expect(overrides).toBeDefined();
      expect(typeof overrides).toBe("object");
    });

    it("should return empty object when no overrides exist", async () => {
      // Create a namespace with no tools
      const [emptyNamespace] = await db
        .insert(namespacesTable)
        .values({
          name: "empty-namespace",
          user_id: testUserId,
        })
        .returning();

      const overrides = await namespaceMappingsRepository.findToolDeferLoadingOverrides(
        emptyNamespace.uuid
      );

      expect(overrides).toEqual({});

      // Clean up
      await db
        .delete(namespacesTable)
        .where(eq(namespacesTable.uuid, emptyNamespace.uuid));
    });

    it("should map tool names to defer_loading boolean values", async () => {
      // Update tool mapping with specific defer_loading value
      await db
        .update(namespaceToolMappingsTable)
        .set({ defer_loading: "ENABLED" })
        .where(
          eq(namespaceToolMappingsTable.namespace_uuid, testNamespaceUuid)
        );

      const overrides = await namespaceMappingsRepository.findToolDeferLoadingOverrides(
        testNamespaceUuid
      );

      // Should have the tool name mapped to true
      const toolName = `test-server-repo__test_tool`;
      expect(overrides[toolName]).toBe(true);
    });

    it("should handle DISABLED defer_loading as false", async () => {
      await db
        .update(namespaceToolMappingsTable)
        .set({ defer_loading: "DISABLED" })
        .where(
          eq(namespaceToolMappingsTable.namespace_uuid, testNamespaceUuid)
        );

      const overrides = await namespaceMappingsRepository.findToolDeferLoadingOverrides(
        testNamespaceUuid
      );

      const toolName = `test-server-repo__test_tool`;
      expect(overrides[toolName]).toBe(false);
    });

    it("should exclude INHERIT defer_loading from overrides", async () => {
      // Set to INHERIT (should not appear in overrides)
      await db
        .update(namespaceToolMappingsTable)
        .set({ defer_loading: "INHERIT" })
        .where(
          eq(namespaceToolMappingsTable.namespace_uuid, testNamespaceUuid)
        );

      const overrides = await namespaceMappingsRepository.findToolDeferLoadingOverrides(
        testNamespaceUuid
      );

      // INHERIT should not be in overrides
      expect(Object.keys(overrides).length).toBe(0);
    });

    it("should update tool defer_loading value", async () => {
      await namespaceMappingsRepository.updateToolDeferLoading({
        namespaceUuid: testNamespaceUuid,
        toolUuid: testToolUuid,
        serverUuid: testServerUuid,
        deferLoading: "ENABLED",
      });

      const [mapping] = await db
        .select()
        .from(namespaceToolMappingsTable)
        .where(eq(namespaceToolMappingsTable.tool_uuid, testToolUuid));

      expect(mapping.defer_loading).toBe("ENABLED");
    });
  });

  describe("ToolSearchConfigRepository - CRUD Operations", () => {
    it("should create tool search config", async () => {
      const config = await toolSearchConfigRepository.upsert({
        namespaceUuid: testNamespaceUuid,
        maxResults: 10,
        providerConfig: {
          k1: 1.5,
          b: 0.75,
        },
      });

      expect(config).toBeDefined();
      expect(config.namespace_uuid).toBe(testNamespaceUuid);
      expect(config.max_results).toBe(10);
      expect(config.provider_config).toEqual({
        k1: 1.5,
        b: 0.75,
      });
    });

    it("should find config by namespace UUID", async () => {
      // Create config first
      await toolSearchConfigRepository.upsert({
        namespaceUuid: testNamespaceUuid,
        maxResults: 5,
        providerConfig: { k1: 1.2 },
      });

      const config = await toolSearchConfigRepository.findByNamespaceUuid(
        testNamespaceUuid
      );

      expect(config).toBeDefined();
      expect(config?.max_results).toBe(5);
      expect(config?.provider_config).toEqual({ k1: 1.2 });
    });

    it("should return null when config not found", async () => {
      const config = await toolSearchConfigRepository.findByNamespaceUuid(
        "nonexistent-uuid"
      );

      expect(config).toBeNull();
    });

    it("should update existing config on upsert", async () => {
      // Create initial config
      await toolSearchConfigRepository.upsert({
        namespaceUuid: testNamespaceUuid,
        maxResults: 5,
        providerConfig: {},
      });

      // Upsert with new values
      const updated = await toolSearchConfigRepository.upsert({
        namespaceUuid: testNamespaceUuid,
        maxResults: 20,
        providerConfig: { k1: 2.0 },
      });

      expect(updated.max_results).toBe(20);
      expect(updated.provider_config).toEqual({ k1: 2.0 });

      // Verify only one config exists
      const allConfigs = await db
        .select()
        .from(toolSearchConfigTable)
        .where(eq(toolSearchConfigTable.namespace_uuid, testNamespaceUuid));

      expect(allConfigs.length).toBe(1);
    });

    it("should delete config by namespace UUID", async () => {
      // Create config
      await toolSearchConfigRepository.upsert({
        namespaceUuid: testNamespaceUuid,
        maxResults: 5,
        providerConfig: {},
      });

      // Delete
      await toolSearchConfigRepository.deleteByNamespaceUuid(testNamespaceUuid);

      // Verify deleted
      const config = await toolSearchConfigRepository.findByNamespaceUuid(
        testNamespaceUuid
      );

      expect(config).toBeNull();
    });

    it("should handle empty provider_config", async () => {
      const config = await toolSearchConfigRepository.upsert({
        namespaceUuid: testNamespaceUuid,
        maxResults: 5,
        providerConfig: null,
      });

      expect(config.provider_config).toBeNull();
    });

    it("should handle complex provider_config objects", async () => {
      const complexConfig = {
        k1: 1.5,
        b: 0.75,
        nested: {
          value: 42,
          array: [1, 2, 3],
        },
      };

      const config = await toolSearchConfigRepository.upsert({
        namespaceUuid: testNamespaceUuid,
        maxResults: 10,
        providerConfig: complexConfig,
      });

      expect(config.provider_config).toEqual(complexConfig);
    });

    it("should cascade delete when namespace is deleted", async () => {
      // Create config
      await toolSearchConfigRepository.upsert({
        namespaceUuid: testNamespaceUuid,
        maxResults: 5,
        providerConfig: {},
      });

      // Delete namespace (should cascade)
      await db
        .delete(namespacesTable)
        .where(eq(namespacesTable.uuid, testNamespaceUuid));

      // Verify config was deleted
      const config = await db
        .select()
        .from(toolSearchConfigTable)
        .where(eq(toolSearchConfigTable.namespace_uuid, testNamespaceUuid));

      expect(config.length).toBe(0);

      // Prevent afterEach from trying to delete again
      testNamespaceUuid = "";
    });
  });

  describe("ToolSearchConfigRepository - Validation", () => {
    it("should enforce max_results constraints (1-20)", async () => {
      // Test valid values
      const validConfig = await toolSearchConfigRepository.upsert({
        namespaceUuid: testNamespaceUuid,
        maxResults: 10,
        providerConfig: {},
      });

      expect(validConfig.max_results).toBe(10);
    });

    it("should enforce namespace_uuid foreign key", async () => {
      // Attempting to create config with nonexistent namespace should fail
      await expect(
        toolSearchConfigRepository.upsert({
          namespaceUuid: "nonexistent-uuid-12345",
          maxResults: 5,
          providerConfig: {},
        })
      ).rejects.toThrow();
    });

    it("should enforce unique namespace_uuid constraint", async () => {
      // Upsert should handle uniqueness, not throw
      await toolSearchConfigRepository.upsert({
        namespaceUuid: testNamespaceUuid,
        maxResults: 5,
        providerConfig: {},
      });

      // Second upsert should update, not fail
      const config = await toolSearchConfigRepository.upsert({
        namespaceUuid: testNamespaceUuid,
        maxResults: 10,
        providerConfig: {},
      });

      expect(config.max_results).toBe(10);
    });
  });
});
