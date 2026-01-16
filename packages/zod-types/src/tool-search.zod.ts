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

// Type exports
export type ToolSearchMethod = z.infer<typeof ToolSearchMethodEnum>;
export type DeferLoadingBehavior = z.infer<typeof DeferLoadingBehaviorEnum>;
export type BM25Config = z.infer<typeof BM25ConfigSchema>;
export type EmbeddingsConfig = z.infer<typeof EmbeddingsConfigSchema>;

// Tool search config request/response schemas
export const ToolSearchConfigUpsertInputSchema = z.object({
  namespaceUuid: z.string().uuid(),
  maxResults: z.number().int().min(1).max(20),
  providerConfig: z.record(z.unknown()).nullable().optional(),
});

export const ToolSearchConfigSchema = z.object({
  namespace_uuid: z.string().uuid(),
  max_results: z.number().int(),
  provider_config: z.record(z.unknown()).nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const ToolSearchConfigResponseSchema = z.object({
  success: z.boolean(),
  data: ToolSearchConfigSchema.optional(),
  message: z.string().optional(),
});

export const GetToolSearchConfigRequestSchema = z.object({
  namespaceUuid: z.string().uuid(),
});

export const UpsertToolSearchConfigRequestSchema = ToolSearchConfigUpsertInputSchema;

export const UpsertToolSearchConfigResponseSchema = z.object({
  success: z.boolean(),
  data: ToolSearchConfigSchema,
  message: z.string().optional(),
});

// Tool defer_loading update schemas
export const UpdateToolDeferLoadingRequestSchema = z.object({
  namespaceUuid: z.string().uuid(),
  toolUuid: z.string().uuid(),
  serverUuid: z.string().uuid(),
  deferLoading: DeferLoadingBehaviorEnum,
});

export const UpdateToolDeferLoadingResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

// Type exports for API schemas
export type ToolSearchConfigUpsertInput = z.infer<typeof ToolSearchConfigUpsertInputSchema>;
export type ToolSearchConfig = z.infer<typeof ToolSearchConfigSchema>;
export type ToolSearchConfigResponse = z.infer<typeof ToolSearchConfigResponseSchema>;
export type GetToolSearchConfigRequest = z.infer<typeof GetToolSearchConfigRequestSchema>;
export type UpsertToolSearchConfigRequest = z.infer<typeof UpsertToolSearchConfigRequestSchema>;
export type UpsertToolSearchConfigResponse = z.infer<typeof UpsertToolSearchConfigResponseSchema>;
export type UpdateToolDeferLoadingRequest = z.infer<typeof UpdateToolDeferLoadingRequestSchema>;
export type UpdateToolDeferLoadingResponse = z.infer<typeof UpdateToolDeferLoadingResponseSchema>;
