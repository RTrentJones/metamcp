/**
 * Tool Search Service
 *
 * High-level orchestration service for tool search.
 * Manages configuration loading, provider instantiation, and search execution.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  SearchProviderFactory,
  type SearchMethod,
} from "./search-provider-factory.js";
import type {
  ToolSearchQuery,
  ToolSearchResult,
  ToolSearchProvider,
} from "./search-interface.js";

/**
 * Configuration resolved from database for search
 */
export interface ResolvedSearchConfig {
  /** Search method to use */
  searchMethod: SearchMethod;

  /** Maximum results to return */
  maxResults: number;

  /** Provider-specific configuration */
  providerConfig?: unknown;
}

/**
 * Service for executing tool searches
 */
export class ToolSearchService {
  private providerCache: Map<string, ToolSearchProvider> = new Map();

  /**
   * Search for tools within a namespace
   *
   * @param query - Search query
   * @param availableTools - Pool of tools to search within
   * @param config - Resolved search configuration
   * @returns Array of matching tools with relevance scores
   */
  async search(
    query: ToolSearchQuery,
    availableTools: Array<{ tool: Tool; serverUuid: string }>,
    config: ResolvedSearchConfig
  ): Promise<ToolSearchResult[]> {
    // Handle NONE search method (return all tools)
    if (config.searchMethod === "NONE") {
      return availableTools.map(({ tool, serverUuid }) => ({
        tool,
        serverUuid,
        score: 0.5,
        matchReason: "Search disabled (method: NONE)",
      }));
    }

    // Get or create search provider
    const provider = await this.getProvider(
      config.searchMethod,
      config.providerConfig
    );

    // Apply max results from config if not specified in query
    const queryWithDefaults: ToolSearchQuery = {
      ...query,
      maxResults: query.maxResults || config.maxResults,
    };

    // Execute search
    return await provider.search(queryWithDefaults, availableTools);
  }

  /**
   * Get or create a search provider (with caching)
   *
   * @param method - Search method
   * @param config - Provider configuration
   * @returns Initialized search provider
   */
  private async getProvider(
    method: SearchMethod,
    config?: unknown
  ): Promise<ToolSearchProvider> {
    // Create cache key from method and config
    const cacheKey = `${method}:${JSON.stringify(config || {})}`;

    // Check cache
    let provider = this.providerCache.get(cacheKey);

    if (!provider) {
      // Create new provider
      provider = await SearchProviderFactory.create(method, config);
      this.providerCache.set(cacheKey, provider);
    }

    return provider;
  }

  /**
   * Clear provider cache (useful when config changes)
   */
  clearCache(): void {
    // Dispose all cached providers
    for (const provider of this.providerCache.values()) {
      if (provider.dispose) {
        provider.dispose().catch((err) => {
          console.error("Error disposing search provider:", err);
        });
      }
    }

    this.providerCache.clear();
  }

  /**
   * Clear a specific provider from cache
   *
   * @param method - Search method to clear
   */
  async clearProviderCache(method: SearchMethod): Promise<void> {
    // Find all cache keys for this method
    const keysToRemove: string[] = [];

    for (const key of this.providerCache.keys()) {
      if (key.startsWith(`${method}:`)) {
        keysToRemove.push(key);
      }
    }

    // Dispose and remove providers
    for (const key of keysToRemove) {
      const provider = this.providerCache.get(key);
      if (provider?.dispose) {
        await provider.dispose();
      }
      this.providerCache.delete(key);
    }
  }

  /**
   * Get supported search methods
   *
   * @returns Array of supported search method names
   */
  getSupportedMethods(): SearchMethod[] {
    return SearchProviderFactory.getSupportedMethods();
  }

  /**
   * Check if a search method is supported
   *
   * @param method - Search method to check
   * @returns True if supported
   */
  isMethodSupported(method: SearchMethod): boolean {
    return SearchProviderFactory.isSupported(method);
  }
}

// Singleton instance
export const toolSearchService = new ToolSearchService();
