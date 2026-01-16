/**
 * Defer Loading Middleware
 *
 * Implements Anthropic's defer_loading feature for tools by:
 * 1. Resolving configuration hierarchy (namespace → endpoint → per-tool)
 * 2. Injecting defer_loading flags into tool definitions
 * 3. Caching resolved configurations for performance
 *
 * This middleware works alongside the tool search feature to reduce
 * context window usage for large tool sets.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  namespacesRepository,
  endpointsRepository,
  namespaceMappingsRepository,
} from "../../../db/repositories/index.js";
import { TOOL_SEARCH_TOOL_NAME } from "../builtin-tools/tool-search-tool.js";

/**
 * Search method enum
 */
export type SearchMethod = "NONE" | "REGEX" | "BM25" | "EMBEDDINGS";

/**
 * Defer loading behavior enum
 */
export type DeferLoadingBehavior = "INHERIT" | "ENABLED" | "DISABLED";

/**
 * Namespace configuration for defer loading
 */
export interface NamespaceConfig {
  default_defer_loading: boolean;
  default_search_method: SearchMethod;
}

/**
 * Endpoint configuration for defer loading
 */
export interface EndpointConfig {
  override_defer_loading: DeferLoadingBehavior;
  override_search_method: SearchMethod | "INHERIT";
}

/**
 * Per-tool defer loading overrides
 * Maps tool name → defer_loading value
 */
export type ToolOverrides = Record<string, boolean>;

/**
 * Resolved defer loading configuration after hierarchy resolution
 */
export interface ResolvedDeferLoadingConfig {
  deferLoadingEnabled: boolean;
  searchMethod: SearchMethod;
  toolOverrides: ToolOverrides;
}

/**
 * Generic defer loading configuration interface
 */
export interface DeferLoadingConfig {
  deferLoadingEnabled: boolean;
  searchMethod: SearchMethod;
  toolOverrides: ToolOverrides;
}

/**
 * Resolve defer loading configuration from hierarchy
 *
 * Priority: Per-tool overrides → Endpoint overrides → Namespace defaults
 *
 * @param namespace - Namespace configuration with defaults
 * @param endpoint - Endpoint configuration with overrides
 * @param toolOverrides - Per-tool overrides
 * @returns Resolved configuration
 */
export function resolveDeferLoadingConfig(
  namespace: NamespaceConfig,
  endpoint: EndpointConfig,
  toolOverrides: ToolOverrides
): ResolvedDeferLoadingConfig {
  // Resolve defer_loading flag
  let deferLoadingEnabled = namespace.default_defer_loading;
  if (endpoint.override_defer_loading === "ENABLED") {
    deferLoadingEnabled = true;
  } else if (endpoint.override_defer_loading === "DISABLED") {
    deferLoadingEnabled = false;
  }
  // INHERIT uses namespace default (already set)

  // Resolve search_method
  let searchMethod = namespace.default_search_method;
  if (
    endpoint.override_search_method !== "INHERIT" &&
    endpoint.override_search_method !== undefined
  ) {
    searchMethod = endpoint.override_search_method;
  }

  return {
    deferLoadingEnabled,
    searchMethod,
    toolOverrides,
  };
}

/**
 * Defer Loading Middleware
 *
 * Injects defer_loading flags into tool definitions based on configuration hierarchy.
 * Caches resolved configurations to minimize database lookups.
 */
export class DeferLoadingMiddleware {
  private configCache: Map<string, ResolvedDeferLoadingConfig> = new Map();
  private pendingFetches: Map<
    string,
    Promise<ResolvedDeferLoadingConfig>
  > = new Map();

  /**
   * Get resolved configuration for an endpoint
   *
   * @param namespaceUuid - Namespace UUID
   * @param endpointUuid - Endpoint UUID
   * @returns Resolved defer loading configuration
   */
  async getResolvedConfig(
    namespaceUuid: string,
    endpointUuid: string
  ): Promise<ResolvedDeferLoadingConfig> {
    // Check cache first
    const cacheKey = endpointUuid;
    const cached = this.configCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Check if fetch is already in progress (prevents race conditions)
    const pending = this.pendingFetches.get(cacheKey);
    if (pending) {
      return pending;
    }

    // Create and store the fetch promise
    const fetchPromise = this.fetchAndCacheConfig(namespaceUuid, endpointUuid);
    this.pendingFetches.set(cacheKey, fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      // Clean up pending fetch
      this.pendingFetches.delete(cacheKey);
    }
  }

  /**
   * Fetch and cache configuration
   *
   * @param namespaceUuid - Namespace UUID
   * @param endpointUuid - Endpoint UUID
   * @returns Resolved configuration
   */
  private async fetchAndCacheConfig(
    namespaceUuid: string,
    endpointUuid: string
  ): Promise<ResolvedDeferLoadingConfig> {
    const cacheKey = endpointUuid;

    try {
      // Fetch namespace configuration
      const namespace = await namespacesRepository.findByUuid(namespaceUuid);
      if (!namespace) {
        console.error(
          `Namespace not found: ${namespaceUuid}. Using fail-safe config.`
        );
        return this.getFailSafeConfig();
      }

      // Fetch endpoint configuration (optional)
      const endpoint = await endpointsRepository.findByUuid(endpointUuid);

      // Fetch per-tool overrides
      const toolOverrides =
        await namespaceMappingsRepository.findToolDeferLoadingOverrides(
          namespaceUuid
        );

      // Resolve configuration hierarchy
      const resolved = resolveDeferLoadingConfig(
        {
          default_defer_loading: namespace.default_defer_loading,
          default_search_method: namespace.default_search_method,
        },
        endpoint
          ? {
              override_defer_loading: endpoint.override_defer_loading,
              override_search_method: endpoint.override_search_method,
            }
          : {
              override_defer_loading: "INHERIT",
              override_search_method: "INHERIT",
            },
        toolOverrides
      );

      // Cache the resolved config
      this.configCache.set(cacheKey, resolved);

      return resolved;
    } catch (error) {
      console.error(
        `Error resolving defer loading config for namespace ${namespaceUuid}, endpoint ${endpointUuid}:`,
        error
      );
      return this.getFailSafeConfig();
    }
  }

  /**
   * Apply defer_loading flags to tools based on configuration
   *
   * @param tools - Original tool list
   * @param config - Resolved configuration
   * @returns New tool list with defer_loading flags applied
   */
  async applyDeferLoading(
    tools: Tool[],
    config: ResolvedDeferLoadingConfig
  ): Promise<Tool[]> {
    return tools.map((tool) => {
      // NEVER apply defer_loading to the search tool itself
      if (tool.name === TOOL_SEARCH_TOOL_NAME) {
        return tool;
      }

      // Check per-tool override first
      const override = config.toolOverrides[tool.name];
      if (override !== undefined) {
        if (override === true) {
          return { ...tool, defer_loading: true };
        } else {
          // override === false, don't add defer_loading
          return tool;
        }
      }

      // Apply global config
      if (config.deferLoadingEnabled) {
        return { ...tool, defer_loading: true };
      }

      // Default: no defer_loading
      return tool;
    });
  }

  /**
   * Process tools through defer loading middleware
   *
   * @param tools - Original tool list
   * @param namespaceUuid - Namespace UUID
   * @param endpointUuid - Endpoint UUID
   * @returns Modified tool list with defer_loading flags
   */
  async process(
    tools: Tool[],
    namespaceUuid: string,
    endpointUuid: string
  ): Promise<Tool[]> {
    try {
      const config = await this.getResolvedConfig(namespaceUuid, endpointUuid);
      return await this.applyDeferLoading(tools, config);
    } catch (error) {
      console.error("Error in defer loading middleware:", error);
      // Fail-safe: return original tools unmodified
      return tools;
    }
  }

  /**
   * Invalidate cache for a specific endpoint
   *
   * @param endpointUuid - Endpoint UUID to invalidate
   */
  invalidateCache(endpointUuid: string): void {
    this.configCache.delete(endpointUuid);
  }

  /**
   * Clear all cached configurations
   */
  clearCache(): void {
    this.configCache.clear();
  }

  /**
   * Get cache statistics
   *
   * @returns Cache size and cached endpoint UUIDs
   */
  getCacheStats(): { size: number; endpoints: string[] } {
    return {
      size: this.configCache.size,
      endpoints: Array.from(this.configCache.keys()),
    };
  }

  /**
   * Get fail-safe configuration (defer loading disabled)
   *
   * @returns Safe default configuration
   */
  private getFailSafeConfig(): ResolvedDeferLoadingConfig {
    return {
      deferLoadingEnabled: false,
      searchMethod: "NONE",
      toolOverrides: {},
    };
  }
}

/**
 * Singleton instance of the defer loading middleware
 */
export const deferLoadingMiddleware = new DeferLoadingMiddleware();
