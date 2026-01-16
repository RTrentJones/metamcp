import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../db/index";
import {
  namespacesTable,
  mcpServersTable,
  endpointsTable,
} from "../db/schema";
import { eq } from "drizzle-orm";
import { endpointsImplementations } from "./endpoints.impl";

describe("Endpoint Tool Search Overrides - Integration Tests", () => {
  // Test data
  let testUserId: string;
  let testNamespaceUuid: string;
  let testServerUuid: string;
  let testEndpointUuid: string;

  beforeEach(async () => {
    testUserId = "test-user-endpoint-123";

    // Create a test MCP server
    const [server] = await db
      .insert(mcpServersTable)
      .values({
        name: "test-server-endpoint",
        type: "STDIO",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
        env: [],
        user_id: testUserId,
      })
      .returning();
    testServerUuid = server.uuid;

    // Create test namespace with defaults
    const [namespace] = await db
      .insert(namespacesTable)
      .values({
        name: "test-namespace-endpoint",
        description: "Test namespace",
        user_id: testUserId,
        default_defer_loading: false,
        default_search_method: "NONE",
      })
      .returning();
    testNamespaceUuid = namespace.uuid;

    // Create test endpoint
    const [endpoint] = await db
      .insert(endpointsTable)
      .values({
        name: "test-endpoint",
        description: "Test endpoint",
        namespace_uuid: testNamespaceUuid,
        user_id: testUserId,
        enable_api_key_auth: true,
        enable_oauth: false,
        use_query_param_auth: false,
      })
      .returning();
    testEndpointUuid = endpoint.uuid;
  });

  afterEach(async () => {
    // Clean up in reverse order of dependencies
    await db
      .delete(endpointsTable)
      .where(eq(endpointsTable.uuid, testEndpointUuid));
    await db
      .delete(namespacesTable)
      .where(eq(namespacesTable.uuid, testNamespaceUuid));
    await db
      .delete(mcpServersTable)
      .where(eq(mcpServersTable.uuid, testServerUuid));
  });

  describe("Endpoint Override Fields - Frontend Integration", () => {
    it("should update endpoint with override_defer_loading", async () => {
      const updateResult = await endpointsImplementations.update(
        {
          uuid: testEndpointUuid,
          name: "test-endpoint",
          namespaceUuid: testNamespaceUuid,
          override_defer_loading: "ENABLED",
        },
        testUserId
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.override_defer_loading).toBe("ENABLED");

      // Verify in database
      const [dbEndpoint] = await db
        .select()
        .from(endpointsTable)
        .where(eq(endpointsTable.uuid, testEndpointUuid));

      expect(dbEndpoint.override_defer_loading).toBe("ENABLED");
    });

    it("should update endpoint with override_search_method", async () => {
      const updateResult = await endpointsImplementations.update(
        {
          uuid: testEndpointUuid,
          name: "test-endpoint",
          namespaceUuid: testNamespaceUuid,
          override_search_method: "BM25",
        },
        testUserId
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.override_search_method).toBe("BM25");

      // Verify in database
      const [dbEndpoint] = await db
        .select()
        .from(endpointsTable)
        .where(eq(endpointsTable.uuid, testEndpointUuid));

      expect(dbEndpoint.override_search_method).toBe("BM25");
    });

    it("should update endpoint with both override fields", async () => {
      const updateResult = await endpointsImplementations.update(
        {
          uuid: testEndpointUuid,
          name: "test-endpoint",
          namespaceUuid: testNamespaceUuid,
          override_defer_loading: "DISABLED",
          override_search_method: "REGEX",
        },
        testUserId
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.override_defer_loading).toBe("DISABLED");
      expect(updateResult.data?.override_search_method).toBe("REGEX");

      // Verify in database
      const [dbEndpoint] = await db
        .select()
        .from(endpointsTable)
        .where(eq(endpointsTable.uuid, testEndpointUuid));

      expect(dbEndpoint.override_defer_loading).toBe("DISABLED");
      expect(dbEndpoint.override_search_method).toBe("REGEX");
    });

    it("should clear override fields with null values", async () => {
      // First set override values
      await endpointsImplementations.update(
        {
          uuid: testEndpointUuid,
          name: "test-endpoint",
          namespaceUuid: testNamespaceUuid,
          override_defer_loading: "ENABLED",
          override_search_method: "BM25",
        },
        testUserId
      );

      // Then clear them
      const updateResult = await endpointsImplementations.update(
        {
          uuid: testEndpointUuid,
          name: "test-endpoint",
          namespaceUuid: testNamespaceUuid,
          override_defer_loading: undefined,
          override_search_method: null,
        },
        testUserId
      );

      expect(updateResult.success).toBe(true);

      // Verify in database - should fall back to namespace defaults
      const [dbEndpoint] = await db
        .select()
        .from(endpointsTable)
        .where(eq(endpointsTable.uuid, testEndpointUuid));

      // When cleared, these fields should be null/undefined
      expect(
        dbEndpoint.override_defer_loading === null ||
        dbEndpoint.override_defer_loading === undefined
      ).toBe(true);
      expect(dbEndpoint.override_search_method).toBeNull();
    });

    it("should accept all valid defer loading behaviors", async () => {
      const behaviors = ["ENABLED", "DISABLED", "INHERIT"] as const;

      for (const behavior of behaviors) {
        const updateResult = await endpointsImplementations.update(
          {
            uuid: testEndpointUuid,
            name: "test-endpoint",
            namespaceUuid: testNamespaceUuid,
            override_defer_loading: behavior,
          },
          testUserId
        );

        expect(updateResult.success).toBe(true);
        expect(updateResult.data?.override_defer_loading).toBe(behavior);
      }
    });

    it("should accept all valid search methods", async () => {
      const methods = ["NONE", "REGEX", "BM25", "EMBEDDINGS"] as const;

      for (const method of methods) {
        const updateResult = await endpointsImplementations.update(
          {
            uuid: testEndpointUuid,
            name: "test-endpoint",
            namespaceUuid: testNamespaceUuid,
            override_search_method: method,
          },
          testUserId
        );

        expect(updateResult.success).toBe(true);
        expect(updateResult.data?.override_search_method).toBe(method);
      }
    });

    it("should return error for unauthorized user", async () => {
      const updateResult = await endpointsImplementations.update(
        {
          uuid: testEndpointUuid,
          name: "test-endpoint",
          namespaceUuid: testNamespaceUuid,
          override_defer_loading: "ENABLED",
        },
        "different-user-id"
      );

      expect(updateResult.success).toBe(false);
      expect(updateResult.message).toContain("not found");
    });

    it("should allow public endpoint update by any user", async () => {
      // Create public endpoint (user_id = null)
      const [publicEndpoint] = await db
        .insert(endpointsTable)
        .values({
          name: "public-endpoint",
          namespace_uuid: testNamespaceUuid,
          user_id: null,
          enable_api_key_auth: true,
        })
        .returning();

      const updateResult = await endpointsImplementations.update(
        {
          uuid: publicEndpoint.uuid,
          name: "public-endpoint",
          namespaceUuid: testNamespaceUuid,
          override_defer_loading: "ENABLED",
        },
        "any-user-id"
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.override_defer_loading).toBe("ENABLED");

      // Clean up
      await db
        .delete(endpointsTable)
        .where(eq(endpointsTable.uuid, publicEndpoint.uuid));
    });
  });

  describe("Integration: Endpoint Overrides with Namespace Defaults", () => {
    it("should demonstrate override behavior vs namespace defaults", async () => {
      // Namespace has defaults
      const [namespace] = await db
        .select()
        .from(namespacesTable)
        .where(eq(namespacesTable.uuid, testNamespaceUuid));

      expect(namespace.default_defer_loading).toBe(false);
      expect(namespace.default_search_method).toBe("NONE");

      // Endpoint can override these
      const updateResult = await endpointsImplementations.update(
        {
          uuid: testEndpointUuid,
          name: "test-endpoint",
          namespaceUuid: testNamespaceUuid,
          override_defer_loading: "ENABLED", // Override namespace default (false)
          override_search_method: "BM25", // Override namespace default (NONE)
        },
        testUserId
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.override_defer_loading).toBe("ENABLED");
      expect(updateResult.data?.override_search_method).toBe("BM25");

      // Verify endpoint overrides are set
      const [dbEndpoint] = await db
        .select()
        .from(endpointsTable)
        .where(eq(endpointsTable.uuid, testEndpointUuid));

      expect(dbEndpoint.override_defer_loading).toBe("ENABLED");
      expect(dbEndpoint.override_search_method).toBe("BM25");

      // The namespace defaults remain unchanged
      const [unchangedNamespace] = await db
        .select()
        .from(namespacesTable)
        .where(eq(namespacesTable.uuid, testNamespaceUuid));

      expect(unchangedNamespace.default_defer_loading).toBe(false);
      expect(unchangedNamespace.default_search_method).toBe("NONE");
    });
  });
});
