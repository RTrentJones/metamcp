/**
 * Tool Search Module
 *
 * Exports all tool search components, providers, and services.
 */

// Core interfaces and types
export type {
  ToolSearchProvider,
  ToolSearchQuery,
  ToolSearchResult,
  BM25Config,
  EmbeddingsConfig,
} from "./search-interface.js";

// Search providers
export { RegexSearchProvider } from "./regex-search-provider.js";
export { BM25SearchProvider } from "./bm25-search-provider.js";

// Provider factory
export {
  SearchProviderFactory,
  type SearchMethod,
} from "./search-provider-factory.js";

// High-level service
export {
  ToolSearchService,
  toolSearchService,
  type ResolvedSearchConfig,
} from "./tool-search-service.js";
