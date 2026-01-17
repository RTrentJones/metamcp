# Tool Search Feature - E2E Test Documentation

This document details the two-part implementation of the tool search feature and explains how each part is tested and verified through E2E tests.

## Overview

The tool search feature implements Anthropic's advanced tool use pattern with two complementary mechanisms:

1. **Part 1: `defer_loading` Flag (Anthropic's Advanced Tool Use)** - Client-side optimization
2. **Part 2: Server-Side Middleware Processing** - Configuration-driven tool list construction

These mechanisms work together to reduce context window usage while maintaining full functionality for all clients.

---

## Part 1: `defer_loading` Flag (Anthropic's Advanced Tool Use)

### Description

The `defer_loading` flag is part of Anthropic's advanced tool use specification. When a tool has `defer_loading: true`, smart clients that support this flag will:
- Not load the tool's full schema into the context window immediately
- Only load the tool when the model explicitly requests to use it

### Implementation

The server injects `defer_loading: true` on tools based on configuration:

```typescript
// Middleware adds defer_loading: true to tools
const processedTools = tools.map(tool => {
  if (tool.name === TOOL_SEARCH_TOOL_NAME) {
    return tool; // Never defer the search tool itself
  }
  if (config.deferLoadingEnabled) {
    return { ...tool, defer_loading: true };
  }
  return tool;
});
```

### Key Behaviors

| Configuration | defer_loading Flag | Search Tool Included |
|---------------|-------------------|---------------------|
| `default_defer_loading: true`, `search_method: BM25` | ✅ Added to tools | ✅ Yes |
| `default_defer_loading: true`, `search_method: NONE` | ✅ Added to tools | ❌ No |
| `default_defer_loading: false`, `search_method: BM25` | ❌ Not added | ❌ No |

### E2E Test Coverage

Located in: `src/lib/metamcp/e2e/tool-search-e2e.test.ts`

**E2E Test 1: defer_loading Flag Conformance with Anthropic's Advanced Tool Use**

| Test Case | Description |
|-----------|-------------|
| `should inject defer_loading: true on all tools when globally enabled` | Verifies flag is added to all tools |
| `should NOT inject defer_loading on the search tool itself` | Ensures search tool remains immediately usable |
| `should respect per-tool overrides when specified` | Tests fine-grained per-tool control |
| `should handle DISABLED at endpoint level` | Tests endpoint override capability |
| `should return defer_loading as boolean true` | Verifies format matches Anthropic spec |
| `should preserve all other tool properties` | Ensures tool metadata is preserved |

### How to Verify

```bash
# Run Part 1 tests
cd apps/backend
pnpm test src/lib/metamcp/e2e/tool-search-e2e.test.ts -- --grep "defer_loading Flag"
```

---

## Part 2: Server-Side Middleware Processing

### Description

Server-side middleware processes the tool list independently of client capabilities. This ensures:
- Correct tool list construction based on namespace/endpoint configuration
- Search tool is included only when properly configured
- All processing happens server-side (no client dependency)

### Implementation

```typescript
// Server-side processing in metamcp-proxy.ts

// 1. Determine if search tool should be included
if (shouldIncludeSearchTool({
  default_defer_loading: namespace.default_defer_loading,
  default_search_method: namespace.default_search_method
})) {
  allTools.push(TOOL_SEARCH_TOOL_DEFINITION);
}

// 2. Apply defer_loading middleware
const processedTools = await deferLoadingMiddleware.process(
  allTools,
  namespaceUuid,
  endpointUuid
);
```

### Configuration Hierarchy

The server resolves configuration in the following priority order:

1. **Per-Tool Overrides** (highest priority)
   - Individual tools can have `defer_loading: ENABLED | DISABLED | INHERIT`

2. **Endpoint Overrides**
   - `override_defer_loading: ENABLED | DISABLED | INHERIT`
   - `override_search_method: REGEX | BM25 | EMBEDDINGS | NONE | INHERIT`

3. **Namespace Defaults** (lowest priority)
   - `default_defer_loading: boolean`
   - `default_search_method: REGEX | BM25 | EMBEDDINGS | NONE`

### E2E Test Coverage

**E2E Test 6: Server-Side Middleware Processing (Part 2)**

| Test Case | Description |
|-----------|-------------|
| `should construct tool list with search tool when properly configured` | Verifies server-side tool list building |
| `should NOT include search tool when search_method is NONE` | Tests search tool conditional inclusion |
| `should NOT include search tool when defer_loading is disabled` | Tests search tool dependency on defer_loading |
| `should process tools server-side regardless of client capabilities` | Verifies client independence |
| `should allow direct tool invocation even with defer_loading: true` | Confirms defer_loading is a hint, not blocker |
| `should apply namespace-level configuration by default` | Tests configuration hierarchy |
| `should apply endpoint-level overrides when specified` | Tests endpoint override capability |
| `should apply per-tool overrides for fine-grained control` | Tests per-tool configuration |

### How to Verify

```bash
# Run Part 2 tests
cd apps/backend
pnpm test src/lib/metamcp/e2e/tool-search-e2e.test.ts -- --grep "Server-Side Middleware"
```

---

## Part 3: Model Workflow (Legacy Client Support)

### Description

Even if a client doesn't support the `defer_loading` flag, the tool search feature remains fully functional. Models can:

1. See all tools (with `defer_loading: true` flag, which they ignore)
2. Use the search tool to discover relevant tools
3. Call discovered tools directly

### Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│ Client connects to MetaMCP server                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Server returns tools/list response:                             │
│ - metamcp_search_tools (no defer_loading)                       │
│ - tool_a (defer_loading: true)                                  │
│ - tool_b (defer_loading: true)                                  │
│ - ...                                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Model invokes: metamcp_search_tools                             │
│ Arguments: { query: "file operations", max_results: 5 }         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Server returns tool_reference blocks:                           │
│ [                                                               │
│   { type: "tool_reference", name: "filesystem__read_file", ... }│
│   { type: "tool_reference", name: "filesystem__write_file",...} │
│ ]                                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Model invokes discovered tool: filesystem__read_file            │
│ Arguments: { path: "/path/to/file" }                            │
└─────────────────────────────────────────────────────────────────┘
```

### E2E Test Coverage

**E2E Test 3: Model Workflow - Search Tool Invocation and Tool Discovery**

| Test Case | Description |
|-----------|-------------|
| `should successfully invoke search tool and receive tool_reference blocks` | End-to-end search workflow |
| `should return relevant tools when searching for 'file' operations` | REGEX search accuracy |
| `should return relevant tools when searching for 'database' operations` | Query relevance |
| `should respect max_results parameter` | Result limiting |
| `should rank tools by relevance using BM25 algorithm` | BM25 ranking |
| `should handle natural language queries` | Natural language support |
| `should complete full workflow: connect -> list tools -> search -> find -> invoke` | Complete workflow simulation |
| `should work even when client does NOT support defer_loading` | Legacy client support |

### How to Verify

```bash
# Run Part 3 (workflow) tests
cd apps/backend
pnpm test src/lib/metamcp/e2e/tool-search-e2e.test.ts -- --grep "Model Workflow"
```

---

## Test Summary

### Running All Tests

```bash
cd apps/backend
pnpm test src/lib/metamcp/e2e/tool-search-e2e.test.ts
```

### Expected Output

```
 ✓ src/lib/metamcp/e2e/tool-search-e2e.test.ts (41 tests) 27ms

 Test Files  1 passed (1)
      Tests  41 passed (41)
```

### Test Breakdown by Part

| Part | Test Suite | Tests |
|------|------------|-------|
| Part 1 | E2E Test 1: defer_loading Flag Conformance | 10 tests |
| Part 2 | E2E Test 2: Tool Filtering with defer_loading Enabled | 5 tests |
| Part 2 | E2E Test 6: Server-Side Middleware Processing | 8 tests |
| Part 3 | E2E Test 3: Model Workflow | 11 tests |
| Supporting | E2E Test 4: Search Provider Integration | 4 tests |
| Supporting | E2E Test 5: Tool Reference Block Format | 3 tests |

---

## Configuration Reference

### Namespace Configuration

```typescript
interface NamespaceConfig {
  default_defer_loading: boolean;     // Enable/disable defer_loading
  default_search_method: SearchMethod; // NONE | REGEX | BM25 | EMBEDDINGS
}
```

### Endpoint Configuration

```typescript
interface EndpointConfig {
  override_defer_loading: DeferLoadingBehavior; // INHERIT | ENABLED | DISABLED
  override_search_method: SearchMethod | 'INHERIT';
}
```

### Per-Tool Configuration

```typescript
// In namespace_tool_mappings table
{
  defer_loading: 'ENABLED' | 'DISABLED' | 'INHERIT'
}
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `e2e/tool-search-e2e.test.ts` | E2E tests for all parts |
| `middleware/defer-loading.ts` | Core defer-loading middleware |
| `builtin-tools/tool-search-tool.ts` | Search tool definition and execution |
| `tool-search/regex-search-provider.ts` | REGEX search implementation |
| `tool-search/bm25-search-provider.ts` | BM25 search implementation |
| `metamcp-middleware/defer-loading.functional.ts` | Functional middleware wrapper |
| `metamcp-middleware/filter-tools.functional.ts` | Tool filtering middleware |
