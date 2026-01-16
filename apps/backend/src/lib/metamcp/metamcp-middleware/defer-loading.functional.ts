/**
 * Defer Loading Functional Middleware
 *
 * Wraps the DeferLoadingMiddleware class as a functional middleware
 * that can be composed into the metamcp-proxy pipeline.
 */

import { deferLoadingMiddleware } from "../middleware/defer-loading.js";
import {
  createFunctionalMiddleware,
  type ListToolsMiddleware,
  type MetaMCPHandlerContext,
} from "./functional-middleware.js";
import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Configuration options for defer-loading middleware
 */
export interface DeferLoadingMiddlewareOptions {
  /**
   * Whether the middleware is enabled
   * @default true
   */
  enabled?: boolean;
}

/**
 * Create a functional defer-loading middleware that injects defer_loading flags
 *
 * This middleware:
 * - Resolves configuration hierarchy (namespace → endpoint → per-tool)
 * - Injects defer_loading: true flags based on configuration
 * - Caches resolved configurations for performance
 * - Requires context.endpointUuid to be set
 *
 * @param options - Middleware configuration options
 * @returns Functional middleware for ListTools handler
 */
export function createDeferLoadingMiddleware(
  options: DeferLoadingMiddlewareOptions = {}
): ListToolsMiddleware {
  const { enabled = true } = options;

  return createFunctionalMiddleware<
    Parameters<ListToolsMiddleware>[0] extends (
      req: infer R,
      ctx: MetaMCPHandlerContext
    ) => Promise<infer Res>
      ? R
      : never,
    ListToolsResult
  >({
    transformResponse: async (response, context) => {
      // Skip if middleware is disabled
      if (!enabled) {
        return response;
      }

      // Skip if no endpoint UUID in context (fail-safe)
      if (!context.endpointUuid) {
        console.warn(
          "DeferLoadingMiddleware: endpointUuid not found in context. Skipping defer_loading injection."
        );
        return response;
      }

      try {
        // Process tools through defer-loading middleware
        const processedTools = await deferLoadingMiddleware.process(
          response.tools,
          context.namespaceUuid,
          context.endpointUuid
        );

        return {
          ...response,
          tools: processedTools,
        };
      } catch (error) {
        console.error(
          "Error in defer-loading middleware, returning original response:",
          error
        );
        // Fail-safe: return original response
        return response;
      }
    },
  });
}
