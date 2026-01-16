import { z } from "zod";

// Tool search method enum
export const ToolSearchMethodEnum = z.enum([
  "NONE",
  "REGEX",
  "BM25",
  "EMBEDDINGS",
]);

// Defer loading behavior enum
export const DeferLoadingBehaviorEnum = z.enum([
  "ENABLED",
  "DISABLED",
  "INHERIT",
]);

// BM25 configuration schema
export const BM25ConfigSchema = z.object({
  k1: z.number().min(0).max(3).optional(),
  b: z.number().min(0).max(1).optional(),
  fields: z.array(z.string()).optional(),
});

// Embeddings configuration schema (for future use)
export const EmbeddingsConfigSchema = z.object({
  model: z.string().optional(),
  similarity_threshold: z.number().min(0).max(1).optional(),
});
