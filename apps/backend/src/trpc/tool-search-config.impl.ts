import {
  GetToolSearchConfigRequest,
  ToolSearchConfigResponse,
  UpsertToolSearchConfigRequest,
  UpsertToolSearchConfigResponse,
} from "@repo/zod-types";

import { toolSearchConfigRepository } from "../db/repositories";

export const toolSearchConfigImplementations = {
  get: async (
    input: GetToolSearchConfigRequest,
  ): Promise<ToolSearchConfigResponse> => {
    try {
      const config =
        await toolSearchConfigRepository.findByNamespaceUuid(
          input.namespaceUuid,
        );

      return {
        success: true,
        data: config || undefined,
      };
    } catch (error) {
      console.error("Error getting tool search config:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },

  upsert: async (
    input: UpsertToolSearchConfigRequest,
  ): Promise<UpsertToolSearchConfigResponse> => {
    try {
      const config = await toolSearchConfigRepository.upsert({
        namespaceUuid: input.namespaceUuid,
        maxResults: input.maxResults,
        providerConfig: input.providerConfig ?? null,
      });

      return {
        success: true,
        data: config,
      };
    } catch (error) {
      console.error("Error upserting tool search config:", error);
      throw error;
    }
  },
};
