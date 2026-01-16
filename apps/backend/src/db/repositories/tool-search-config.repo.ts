import { eq } from "drizzle-orm";
import { db } from "../index";
import { toolSearchConfigTable } from "../schema";

/**
 * Tool Search Config Repository
 *
 * Manages tool_search_config table for namespace-level search provider configuration.
 * Stores provider-specific settings like BM25 parameters.
 */
export class ToolSearchConfigRepository {
  /**
   * Find tool search config by namespace UUID
   *
   * @param namespaceUuid - Namespace UUID
   * @returns Tool search config or null
   */
  async findByNamespaceUuid(namespaceUuid: string) {
    const [config] = await db
      .select()
      .from(toolSearchConfigTable)
      .where(eq(toolSearchConfigTable.namespace_uuid, namespaceUuid));

    return config || null;
  }

  /**
   * Upsert tool search config for a namespace
   *
   * @param input - Config input
   * @returns Created or updated config
   */
  async upsert(input: {
    namespaceUuid: string;
    maxResults: number;
    providerConfig: Record<string, unknown> | null;
  }) {
    const [config] = await db
      .insert(toolSearchConfigTable)
      .values({
        namespace_uuid: input.namespaceUuid,
        max_results: input.maxResults,
        provider_config: input.providerConfig,
      })
      .onConflictDoUpdate({
        target: [toolSearchConfigTable.namespace_uuid],
        set: {
          max_results: input.maxResults,
          provider_config: input.providerConfig,
          updated_at: new Date(),
        },
      })
      .returning();

    return config;
  }

  /**
   * Delete tool search config by namespace UUID
   *
   * @param namespaceUuid - Namespace UUID
   */
  async deleteByNamespaceUuid(namespaceUuid: string) {
    await db
      .delete(toolSearchConfigTable)
      .where(eq(toolSearchConfigTable.namespace_uuid, namespaceUuid));
  }
}

export const toolSearchConfigRepository = new ToolSearchConfigRepository();
