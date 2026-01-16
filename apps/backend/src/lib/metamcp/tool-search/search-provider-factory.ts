/**
 * Search Provider Factory
 *
 * Registry and factory for tool search providers.
 * Manages provider instantiation and configuration.
 */

import type { ToolSearchProvider } from "./search-interface.js";
import { RegexSearchProvider } from "./regex-search-provider.js";
import { BM25SearchProvider } from "./bm25-search-provider.js";

/**
 * Search method types
 */
export type SearchMethod = "NONE" | "REGEX" | "BM25" | "EMBEDDINGS";

/**
 * Provider constructor type
 */
type ProviderConstructor = new () => ToolSearchProvider;

/**
 * Factory for creating and managing search providers
 */
export class SearchProviderFactory {
  private static providers: Map<SearchMethod, ProviderConstructor> = new Map();

  /**
   * Register built-in providers
   */
  static {
    SearchProviderFactory.register("REGEX", RegexSearchProvider);
    SearchProviderFactory.register("BM25", BM25SearchProvider);
    // Note: EMBEDDINGS provider not yet implemented
  }

  /**
   * Register a search provider
   *
   * @param method - The search method name
   * @param provider - The provider class constructor
   */
  static register(method: SearchMethod, provider: ProviderConstructor): void {
    this.providers.set(method, provider);
  }

  /**
   * Create a search provider instance
   *
   * @param method - The search method to use
   * @param config - Optional configuration for the provider
   * @returns Initialized search provider
   * @throws Error if provider is not registered
   */
  static async create(
    method: SearchMethod,
    config?: unknown
  ): Promise<ToolSearchProvider> {
    if (method === "NONE") {
      throw new Error(
        "Cannot create provider for NONE search method. Use a specific search method."
      );
    }

    const ProviderClass = this.providers.get(method);

    if (!ProviderClass) {
      throw new Error(
        `Search provider "${method}" is not registered. Available providers: ${[
          ...this.providers.keys(),
        ].join(", ")}`
      );
    }

    const provider = new ProviderClass();

    // Initialize with config if provided and supported
    if (config && provider.initialize) {
      await provider.initialize(config);
    }

    return provider;
  }

  /**
   * Check if a search method is supported
   *
   * @param method - The search method to check
   * @returns True if the provider is registered
   */
  static isSupported(method: SearchMethod): boolean {
    if (method === "NONE") {
      return true; // NONE is always "supported" (means no search)
    }
    return this.providers.has(method);
  }

  /**
   * Get list of all registered search methods
   *
   * @returns Array of supported search method names
   */
  static getSupportedMethods(): SearchMethod[] {
    return ["NONE", ...this.providers.keys()];
  }
}
