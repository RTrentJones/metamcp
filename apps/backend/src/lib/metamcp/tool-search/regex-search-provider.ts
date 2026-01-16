/**
 * Regex Search Provider
 *
 * Implements pattern-based tool search using regular expressions.
 * Searches tool names and descriptions with configurable patterns.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type {
  ToolSearchProvider,
  ToolSearchQuery,
  ToolSearchResult,
} from "./search-interface.js";

/**
 * Configuration for regex search
 */
export interface RegexSearchConfig {
  /** Custom regex pattern (if not provided, uses query as literal substring) */
  pattern?: string;

  /** Whether to search case-insensitively (default: true) */
  caseInsensitive?: boolean;

  /** Fields to search (default: ["name", "description"]) */
  fields?: Array<"name" | "description">;
}

/**
 * Regex-based tool search provider
 */
export class RegexSearchProvider implements ToolSearchProvider {
  readonly name = "REGEX";
  private config: RegexSearchConfig = {
    caseInsensitive: true,
    fields: ["name", "description"],
  };

  /**
   * Initialize with configuration
   */
  async initialize(config: unknown): Promise<void> {
    if (typeof config === "object" && config !== null) {
      this.config = { ...this.config, ...(config as RegexSearchConfig) };
    }
  }

  /**
   * Search for tools using regex pattern matching
   */
  async search(
    query: ToolSearchQuery,
    availableTools: Array<{ tool: Tool; serverUuid: string }>
  ): Promise<ToolSearchResult[]> {
    // Check if we have a custom pattern or a query
    const hasCustomPattern = this.config.pattern !== undefined;
    const hasQuery = query.query && query.query.trim().length > 0;

    // If no custom pattern and no query, return all tools with neutral score
    if (!hasCustomPattern && !hasQuery) {
      const maxResults = query.maxResults || 5;
      return availableTools.slice(0, maxResults).map(({ tool, serverUuid }) => ({
        tool,
        serverUuid,
        score: 0.5,
        matchReason: "No search query provided",
      }));
    }

    // Build regex pattern
    const pattern = this.config.pattern || this.escapeRegexLiteral(query.query);
    const flags = this.config.caseInsensitive ? "i" : "";

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch (error) {
      // Invalid regex, fallback to literal substring match
      const escapedQuery = this.escapeRegexLiteral(query.query);
      regex = new RegExp(escapedQuery, flags);
    }

    // Search through tools
    const results: ToolSearchResult[] = [];
    const fields = this.config.fields || ["name", "description"];

    for (const { tool, serverUuid } of availableTools) {
      const matches = this.searchTool(tool, regex, fields);

      if (matches.length > 0) {
        // Calculate relevance score based on matches
        const score = this.calculateScore(matches);
        const matchReason = this.buildMatchReason(matches);

        results.push({
          tool,
          serverUuid,
          score,
          matchReason,
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Apply max results limit
    const maxResults = query.maxResults || 5;
    return results.slice(0, maxResults);
  }

  /**
   * Search a single tool for regex matches
   */
  private searchTool(
    tool: Tool,
    regex: RegExp,
    fields: Array<"name" | "description">
  ): Array<{ field: string; index: number; length: number }> {
    const matches: Array<{ field: string; index: number; length: number }> = [];

    for (const field of fields) {
      const text = field === "name" ? tool.name : tool.description || "";
      const match = regex.exec(text);

      if (match) {
        matches.push({
          field,
          index: match.index,
          length: match[0].length,
        });
      }
    }

    return matches;
  }

  /**
   * Calculate relevance score based on matches
   *
   * Scoring logic:
   * - Name match: higher score than description match
   * - Earlier position: higher score
   * - Longer match: higher score
   */
  private calculateScore(
    matches: Array<{ field: string; index: number; length: number }>
  ): number {
    let totalScore = 0;

    for (const match of matches) {
      let score = 0;

      // Field weight (name is more important than description)
      if (match.field === "name") {
        score += 0.6;
      } else {
        score += 0.3;
      }

      // Position bonus (earlier match is better)
      // Decay from 0.2 at position 0 to 0.05 at position 50+
      const positionBonus = Math.max(0.05, 0.2 - match.index * 0.003);
      score += positionBonus;

      // Length bonus (longer match is better, up to 0.2)
      const lengthBonus = Math.min(0.2, match.length * 0.02);
      score += lengthBonus;

      totalScore += score;
    }

    // Normalize to 0-1 range
    return Math.min(1.0, totalScore);
  }

  /**
   * Build human-readable match reason
   */
  private buildMatchReason(
    matches: Array<{ field: string; index: number; length: number }>
  ): string {
    const fieldMatches = matches.map((m) => m.field);
    const uniqueFields = [...new Set(fieldMatches)];

    if (uniqueFields.length === 1) {
      return `Matched in ${uniqueFields[0]}`;
    } else {
      return `Matched in ${uniqueFields.join(", ")}`;
    }
  }

  /**
   * Escape special regex characters for literal matching
   */
  private escapeRegexLiteral(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    // No resources to clean up for regex provider
  }
}
