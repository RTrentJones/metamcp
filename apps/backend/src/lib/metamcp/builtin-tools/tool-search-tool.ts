/**
 * Tool Search Tool - Built-in MCP Tool
 *
 * Implements Anthropic's tool search tool feature that returns tool_reference blocks
 * for dynamically discovering tools based on search queries.
 *
 * This tool is automatically added to namespaces that have defer_loading enabled
 * with a search method other than NONE.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  toolSearchService,
  type ResolvedSearchConfig,
  type ToolSearchResult,
} from "../tool-search/index.js";

/**
 * Tool name for the search tool
 */
export const TOOL_SEARCH_TOOL_NAME = "metamcp_search_tools";

/**
 * Tool definition following MCP Tool schema
 */
export const TOOL_SEARCH_TOOL_DEFINITION: Tool = {
  name: TOOL_SEARCH_TOOL_NAME,
  description:
    "Search for tools by query. Returns references to matching tools that can be dynamically loaded. " +
    "Use this when you need to discover tools without loading all tools upfront. " +
    "The query can be keywords describing what you want to do (e.g., 'read files', 'web scraping', 'database').",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query to find relevant tools. Can be keywords or natural language description.",
      },
      max_results: {
        type: "number",
        description: "Maximum number of tool references to return (default: 5, max: 20)",
        minimum: 1,
        maximum: 20,
      },
    },
    required: ["query"],
  },
};

/**
 * Tool search arguments schema
 */
export interface ToolSearchArguments {
  query: string;
  max_results?: number;
}

/**
 * Tool reference block as defined by Anthropic
 */
export interface ToolReferenceBlock {
  type: "tool_reference";
  name: string;
  description: string;
}

/**
 * Tool search result format for MCP
 */
export interface ToolSearchCallToolResult {
  content: ToolReferenceBlock[];
  isError?: boolean;
}

/**
 * Namespace config for determining if search tool should be included
 */
export interface NamespaceSearchConfig {
  default_defer_loading: boolean;
  default_search_method: "NONE" | "REGEX" | "BM25" | "EMBEDDINGS";
}

/**
 * Determine if the search tool should be included in tool list
 *
 * @param namespaceConfig - Namespace configuration
 * @returns True if search tool should be included
 */
export function shouldIncludeSearchTool(
  namespaceConfig: NamespaceSearchConfig
): boolean {
  return (
    namespaceConfig.default_defer_loading &&
    namespaceConfig.default_search_method !== "NONE"
  );
}

/**
 * Create a tool_reference block from a search result
 *
 * @param result - Tool search result
 * @returns Tool reference block
 */
export function createToolReferenceBlock(
  result: ToolSearchResult
): ToolReferenceBlock {
  const originalDesc = result.tool.description || "No description available";
  const scoreFormatted = result.score.toFixed(2);

  return {
    type: "tool_reference",
    name: result.tool.name,
    description: `${originalDesc} (score: ${scoreFormatted}, ${result.matchReason})`,
  };
}

/**
 * Execute tool search and return tool_reference blocks
 *
 * @param args - Tool search arguments
 * @param availableTools - Pool of tools to search within
 * @param searchConfig - Resolved search configuration
 * @returns CallToolResult with tool_reference blocks
 */
export async function executeToolSearch(
  args: ToolSearchArguments,
  availableTools: Array<{ tool: Tool; serverUuid: string }>,
  searchConfig: ResolvedSearchConfig
): Promise<ToolSearchCallToolResult> {
  // Use max_results from args if provided, otherwise use config
  const maxResults = args.max_results || searchConfig.maxResults;

  // Execute search
  const searchResults = await toolSearchService.search(
    {
      query: args.query,
      maxResults,
    },
    availableTools,
    searchConfig
  );

  // Convert search results to tool_reference blocks
  const toolReferenceBlocks = searchResults.map(createToolReferenceBlock);

  return {
    content: toolReferenceBlocks,
  };
}
