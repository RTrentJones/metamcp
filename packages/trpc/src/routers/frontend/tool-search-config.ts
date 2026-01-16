import {
  GetToolSearchConfigRequest,
  GetToolSearchConfigRequestSchema,
  ToolSearchConfig,
  ToolSearchConfigResponse,
  UpsertToolSearchConfigRequest,
  UpsertToolSearchConfigRequestSchema,
  UpsertToolSearchConfigResponse,
} from "@repo/zod-types";

import { protectedProcedure, router } from "../../trpc";

export const createToolSearchConfigRouter = (implementations: {
  get: (
    input: GetToolSearchConfigRequest,
  ) => Promise<ToolSearchConfigResponse>;
  upsert: (
    input: UpsertToolSearchConfigRequest,
  ) => Promise<UpsertToolSearchConfigResponse>;
}) =>
  router({
    get: protectedProcedure
      .input(GetToolSearchConfigRequestSchema)
      .query(async ({ input }) => {
        return await implementations.get(input);
      }),

    upsert: protectedProcedure
      .input(UpsertToolSearchConfigRequestSchema)
      .mutation(async ({ input }) => {
        return await implementations.upsert(input);
      }),
  });
