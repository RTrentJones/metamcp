import {
  NamespaceServerStatusUpdate,
  NamespaceToolOverridesUpdate,
  NamespaceToolStatusUpdate,
} from "@repo/zod-types";
import { and, eq, ne, or, sql } from "drizzle-orm";

import { db } from "../index";
import {
  mcpServersTable,
  namespaceServerMappingsTable,
  namespaceToolMappingsTable,
  toolsTable,
} from "../schema";
import { sanitizeName } from "../../lib/metamcp/utils";

export class NamespaceMappingsRepository {
  async updateServerStatus(input: NamespaceServerStatusUpdate) {
    const [updatedMapping] = await db
      .update(namespaceServerMappingsTable)
      .set({
        status: input.status,
      })
      .where(
        and(
          eq(namespaceServerMappingsTable.namespace_uuid, input.namespaceUuid),
          eq(namespaceServerMappingsTable.mcp_server_uuid, input.serverUuid),
        ),
      )
      .returning();

    return updatedMapping;
  }

  async updateToolStatus(input: NamespaceToolStatusUpdate) {
    const [updatedMapping] = await db
      .update(namespaceToolMappingsTable)
      .set({
        status: input.status,
      })
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, input.namespaceUuid),
          eq(namespaceToolMappingsTable.tool_uuid, input.toolUuid),
          eq(namespaceToolMappingsTable.mcp_server_uuid, input.serverUuid),
        ),
      )
      .returning();

    return updatedMapping;
  }

  async updateToolOverrides(input: NamespaceToolOverridesUpdate) {
    const [updatedMapping] = await db
      .update(namespaceToolMappingsTable)
      .set({
        override_name: input.overrideName,
        override_title: input.overrideTitle,
        override_description: input.overrideDescription,
        override_annotations: input.overrideAnnotations,
      })
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, input.namespaceUuid),
          eq(namespaceToolMappingsTable.tool_uuid, input.toolUuid),
          eq(namespaceToolMappingsTable.mcp_server_uuid, input.serverUuid),
        ),
      )
      .returning();

    return updatedMapping;
  }

  async findServerMapping(namespaceUuid: string, serverUuid: string) {
    const [mapping] = await db
      .select()
      .from(namespaceServerMappingsTable)
      .where(
        and(
          eq(namespaceServerMappingsTable.namespace_uuid, namespaceUuid),
          eq(namespaceServerMappingsTable.mcp_server_uuid, serverUuid),
        ),
      );

    return mapping;
  }

  /**
   * Find all namespace UUIDs that use a specific MCP server
   */
  async findNamespacesByServerUuid(serverUuid: string): Promise<string[]> {
    const mappings = await db
      .select({
        namespace_uuid: namespaceServerMappingsTable.namespace_uuid,
      })
      .from(namespaceServerMappingsTable)
      .where(eq(namespaceServerMappingsTable.mcp_server_uuid, serverUuid));

    return mappings.map((mapping) => mapping.namespace_uuid);
  }

  /**
   * Get all existing tool mappings for a namespace
   */
  async findToolMappingsByNamespace(namespaceUuid: string) {
    const mappings = await db
      .select()
      .from(namespaceToolMappingsTable)
      .where(eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid));

    return mappings;
  }

  async findToolMapping(
    namespaceUuid: string,
    toolUuid: string,
    serverUuid: string,
  ) {
    const [mapping] = await db
      .select()
      .from(namespaceToolMappingsTable)
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid),
          eq(namespaceToolMappingsTable.tool_uuid, toolUuid),
          eq(namespaceToolMappingsTable.mcp_server_uuid, serverUuid),
        ),
      );

    return mapping;
  }

  /**
   * Bulk upsert namespace tool mappings for a namespace
   * Used when refreshing tools from MetaMCP connection
   */
  async bulkUpsertNamespaceToolMappings(input: {
    namespaceUuid: string;
    toolMappings: Array<{
      toolUuid: string;
      serverUuid: string;
      status?: "ACTIVE" | "INACTIVE";
    }>;
  }) {
    if (!input.toolMappings || input.toolMappings.length === 0) {
      return [];
    }

    const mappingsToInsert = input.toolMappings.map((mapping) => ({
      namespace_uuid: input.namespaceUuid,
      tool_uuid: mapping.toolUuid,
      mcp_server_uuid: mapping.serverUuid,
      status: (mapping.status || "ACTIVE") as "ACTIVE" | "INACTIVE",
    }));

    // Upsert the mappings - if they exist, update the status; if not, insert them
    return await db
      .insert(namespaceToolMappingsTable)
      .values(mappingsToInsert)
      .onConflictDoUpdate({
        target: [
          namespaceToolMappingsTable.namespace_uuid,
          namespaceToolMappingsTable.tool_uuid,
        ],
        set: {
          status: sql`excluded.status`,
          mcp_server_uuid: sql`excluded.mcp_server_uuid`,
        },
      })
      .returning();
  }

  /**
   * Find tool defer_loading overrides for a namespace
   * Returns a map of tool names to boolean values (ENABLED=true, DISABLED=false)
   * Excludes tools with INHERIT (no explicit override)
   *
   * @param namespaceUuid - Namespace UUID
   * @returns Map of tool names to defer_loading boolean values
   */
  async findToolDeferLoadingOverrides(
    namespaceUuid: string
  ): Promise<Record<string, boolean>> {
    const mappings = await db
      .select({
        defer_loading: namespaceToolMappingsTable.defer_loading,
        tool_name: toolsTable.name,
        server_name: mcpServersTable.name,
      })
      .from(namespaceToolMappingsTable)
      .innerJoin(
        toolsTable,
        eq(namespaceToolMappingsTable.tool_uuid, toolsTable.uuid)
      )
      .innerJoin(
        mcpServersTable,
        eq(namespaceToolMappingsTable.mcp_server_uuid, mcpServersTable.uuid)
      )
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid),
          // Only include explicit overrides (not INHERIT)
          or(
            eq(namespaceToolMappingsTable.defer_loading, "ENABLED"),
            eq(namespaceToolMappingsTable.defer_loading, "DISABLED")
          )
        )
      );

    // Build the overrides map: tool name -> boolean
    const overrides: Record<string, boolean> = {};
    for (const mapping of mappings) {
      // Construct full tool name: serverName__toolName
      const fullToolName = `${sanitizeName(mapping.server_name)}__${mapping.tool_name}`;
      overrides[fullToolName] = mapping.defer_loading === "ENABLED";
    }

    return overrides;
  }

  /**
   * Update tool defer_loading value for a specific tool mapping
   *
   * @param input - Update input
   * @returns Updated mapping
   */
  async updateToolDeferLoading(input: {
    namespaceUuid: string;
    toolUuid: string;
    serverUuid: string;
    deferLoading: "ENABLED" | "DISABLED" | "INHERIT";
  }) {
    const [updatedMapping] = await db
      .update(namespaceToolMappingsTable)
      .set({
        defer_loading: input.deferLoading,
      })
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, input.namespaceUuid),
          eq(namespaceToolMappingsTable.tool_uuid, input.toolUuid),
          eq(namespaceToolMappingsTable.mcp_server_uuid, input.serverUuid)
        )
      )
      .returning();

    return updatedMapping;
  }
}

export const namespaceMappingsRepository = new NamespaceMappingsRepository();
