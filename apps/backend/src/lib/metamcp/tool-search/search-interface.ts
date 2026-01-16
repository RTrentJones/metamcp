/**
 * Tool Search Interface
 *
 * Defines the core abstractions for tool search providers.
 * Supports pluggable search implementations (Regex, BM25, Embeddings).
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Tool search query input
 */
export interface ToolSearchQuery {
  /** The search query string (user's natural language request or pattern) */
  query: string;

  /** Maximum number of results to return */
  maxResults?: number;

  /** Optional namespace UUID for context-specific search */
  namespaceUuid?: string;

  /** Optional endpoint UUID for context-specific search */
  endpointUuid?: string;
}

/**
 * Tool search result with relevance scoring
 */
export interface ToolSearchResult {
  /** The matching tool */
  tool: Tool;

  /** Relevance score (0-1, higher is more relevant) */
  score: number;

  /** Optional explanation of why this tool matched */
  matchReason?: string;

  /** The server UUID this tool belongs to */
  serverUuid: string;
}

/**
 * Abstract tool search provider interface.
 * Implementations must provide search logic for different algorithms.
 */
export interface ToolSearchProvider {
  /**
   * Returns the search method name (e.g., "REGEX", "BM25", "EMBEDDINGS")
   */
  readonly name: string;

  /**
   * Search for tools matching the query
   *
   * @param query - The search query
   * @param availableTools - The pool of tools to search within
   * @returns Array of matching tools with relevance scores, sorted by score descending
   */
  search(
    query: ToolSearchQuery,
    availableTools: Array<{ tool: Tool; serverUuid: string }>
  ): Promise<ToolSearchResult[]>;

  /**
   * Optional: Initialize the provider with configuration
   *
   * @param config - Provider-specific configuration
   */
  initialize?(config: unknown): Promise<void>;

  /**
   * Optional: Clean up resources
   */
  dispose?(): Promise<void>;
}

/**
 * Configuration for BM25 search provider
 */
export interface BM25Config {
  /** BM25 k1 parameter (term frequency saturation, default: 1.2) */
  k1?: number;

  /** BM25 b parameter (length normalization, default: 0.75) */
  b?: number;

  /** Fields to search (default: ["name", "description"]) */
  fields?: string[];
}

/**
 * Configuration for embeddings search provider (future)
 */
export interface EmbeddingsConfig {
  /** Embedding model to use */
  model?: string;

  /** Similarity threshold for matching (0-1) */
  similarity_threshold?: number;
}
