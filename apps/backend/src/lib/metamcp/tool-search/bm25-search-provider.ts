/**
 * BM25 Search Provider
 *
 * Implements BM25 (Best Matching 25) ranking algorithm for tool search.
 * BM25 is a probabilistic ranking function based on TF-IDF.
 *
 * Reference: https://en.wikipedia.org/wiki/Okapi_BM25
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type {
  ToolSearchProvider,
  ToolSearchQuery,
  ToolSearchResult,
  BM25Config,
} from "./search-interface.js";

/**
 * Document representation for BM25 scoring
 */
interface Document {
  tool: Tool;
  serverUuid: string;
  tokens: Map<string, number>; // term -> frequency
  length: number; // total token count
}

/**
 * BM25-based tool search provider
 */
export class BM25SearchProvider implements ToolSearchProvider {
  readonly name = "BM25";

  // BM25 parameters
  private k1: number = 1.2; // Term frequency saturation parameter
  private b: number = 0.75; // Length normalization parameter
  private fields: string[] = ["name", "description"];

  // Index state
  private documents: Document[] = [];
  private avgDocLength: number = 0;
  private idfCache: Map<string, number> = new Map();

  /**
   * Initialize with configuration
   */
  async initialize(config: unknown): Promise<void> {
    if (typeof config === "object" && config !== null) {
      const bm25Config = config as BM25Config;

      if (bm25Config.k1 !== undefined) {
        this.k1 = bm25Config.k1;
      }
      if (bm25Config.b !== undefined) {
        this.b = bm25Config.b;
      }
      if (bm25Config.fields !== undefined) {
        this.fields = bm25Config.fields;
      }
    }
  }

  /**
   * Search for tools using BM25 ranking
   */
  async search(
    query: ToolSearchQuery,
    availableTools: Array<{ tool: Tool; serverUuid: string }>
  ): Promise<ToolSearchResult[]> {
    if (!query.query || query.query.trim().length === 0) {
      // Empty query returns tools (up to maxResults) with neutral score
      const maxResults = query.maxResults || 5;
      return availableTools.slice(0, maxResults).map(({ tool, serverUuid }) => ({
        tool,
        serverUuid,
        score: 0.5,
        matchReason: "No search query provided",
      }));
    }

    // Build document index
    this.buildIndex(availableTools);

    // Tokenize query
    const queryTokens = this.tokenize(query.query);

    if (queryTokens.length === 0) {
      // No valid tokens, return empty results
      return [];
    }

    // Score all documents
    const results: ToolSearchResult[] = [];

    for (const doc of this.documents) {
      const score = this.calculateBM25Score(queryTokens, doc);

      if (score > 0) {
        results.push({
          tool: doc.tool,
          serverUuid: doc.serverUuid,
          score,
          matchReason: this.buildMatchReason(queryTokens, doc),
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
   * Build inverted index from available tools
   */
  private buildIndex(
    availableTools: Array<{ tool: Tool; serverUuid: string }>
  ): void {
    this.documents = [];
    this.idfCache.clear();

    let totalLength = 0;

    // Create document representations
    for (const { tool, serverUuid } of availableTools) {
      const text = this.extractText(tool);
      const tokens = this.tokenize(text);
      const termFreq = this.calculateTermFrequency(tokens);

      const doc: Document = {
        tool,
        serverUuid,
        tokens: termFreq,
        length: tokens.length,
      };

      this.documents.push(doc);
      totalLength += doc.length;
    }

    // Calculate average document length
    this.avgDocLength =
      this.documents.length > 0 ? totalLength / this.documents.length : 0;

    // Precompute IDF scores
    this.computeIDF();
  }

  /**
   * Extract searchable text from tool based on configured fields
   */
  private extractText(tool: Tool): string {
    const parts: string[] = [];

    for (const field of this.fields) {
      if (field === "name") {
        parts.push(tool.name);
      } else if (field === "description" && tool.description) {
        parts.push(tool.description);
      }
    }

    return parts.join(" ");
  }

  /**
   * Tokenize text into terms (lowercase, alphanumeric)
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length > 0);
  }

  /**
   * Calculate term frequency map
   */
  private calculateTermFrequency(tokens: string[]): Map<string, number> {
    const freq = new Map<string, number>();

    for (const token of tokens) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }

    return freq;
  }

  /**
   * Compute IDF (Inverse Document Frequency) scores for all terms
   *
   * IDF(term) = log((N - df(term) + 0.5) / (df(term) + 0.5) + 1)
   * where N is total documents and df(term) is document frequency
   */
  private computeIDF(): void {
    const N = this.documents.length;
    const docFreq = new Map<string, number>();

    // Count document frequency for each term
    for (const doc of this.documents) {
      const uniqueTerms = new Set(doc.tokens.keys());
      for (const term of uniqueTerms) {
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
      }
    }

    // Calculate IDF for each term
    for (const [term, df] of docFreq.entries()) {
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      this.idfCache.set(term, idf);
    }
  }

  /**
   * Calculate BM25 score for a document given query terms
   *
   * BM25(D,Q) = Σ IDF(qi) * (f(qi,D) * (k1 + 1)) / (f(qi,D) + k1 * (1 - b + b * |D| / avgdl))
   */
  private calculateBM25Score(queryTokens: string[], doc: Document): number {
    let score = 0;

    // Length normalization factor
    const normFactor = 1 - this.b + this.b * (doc.length / this.avgDocLength);

    for (const term of queryTokens) {
      const idf = this.idfCache.get(term) || 0;
      const termFreq = doc.tokens.get(term) || 0;

      if (termFreq > 0) {
        // BM25 formula
        const numerator = termFreq * (this.k1 + 1);
        const denominator = termFreq + this.k1 * normFactor;
        score += idf * (numerator / denominator);
      }
    }

    // Normalize score to 0-1 range (approximate)
    // Maximum possible score would be if all query terms matched with max IDF
    const maxPossibleScore = queryTokens.length * Math.log(this.documents.length + 1) * (this.k1 + 1);
    const normalizedScore = maxPossibleScore > 0 ? Math.min(1.0, score / maxPossibleScore) : 0;

    return normalizedScore;
  }

  /**
   * Build human-readable match reason
   */
  private buildMatchReason(queryTokens: string[], doc: Document): string {
    const matchedTerms = queryTokens.filter((term) => doc.tokens.has(term));

    if (matchedTerms.length === 0) {
      return "No direct term matches";
    }

    const uniqueMatched = [...new Set(matchedTerms)];

    if (uniqueMatched.length === 1) {
      return `Matched term: "${uniqueMatched[0]}"`;
    } else if (uniqueMatched.length <= 3) {
      return `Matched terms: ${uniqueMatched.map((t) => `"${t}"`).join(", ")}`;
    } else {
      return `Matched ${uniqueMatched.length} terms`;
    }
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    this.documents = [];
    this.idfCache.clear();
  }
}
