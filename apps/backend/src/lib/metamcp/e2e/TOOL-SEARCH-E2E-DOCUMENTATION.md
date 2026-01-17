# Tool Search Feature - E2E Test Documentation

This document details the three-part implementation of the tool search feature and explains how each part is tested and verified through E2E tests.

## Overview

The tool search feature implements Anthropic's advanced tool use pattern with three complementary mechanisms:

1. **Part 1: `defer_loading` Flag (Anthropic's Advanced Tool Use)** - Client-side optimization for smart clients
2. **Part 2: `SEARCH_ONLY` Mode (Strict Server-Side Filtering)** - Maximum context savings for all clients
3. **Part 3: Model Workflow** - Search tool invocation and discovery for legacy clients

These mechanisms work together to reduce context window usage while maintaining full functionality for all clients.

---

## Part 1: `defer_loading` Flag (Anthropic's Advanced Tool Use)

### Description

The `defer_loading` flag is part of Anthropic's advanced tool use specification. When a tool has `defer_loading: true`, smart clients that support this flag will:
- Not load the tool's full schema into the context window immediately
- Only load the tool when the model explicitly requests to use it

### Configuration

| Setting | Location | Values |
|---------|----------|--------|
| `default_defer_loading` | Namespace | `true` / `false` |
| `override_defer_loading` | Endpoint | `INHERIT` / `ENABLED` / `DISABLED` |
| `defer_loading` | Per-tool | `INHERIT` / `ENABLED` / `DISABLED` |

### Key Behaviors

| Configuration | defer_loading Flag | Search Tool Included |
|---------------|-------------------|---------------------|
| `default_defer_loading: true`, `search_method: BM25` | ✅ Added to tools | ✅ Yes |
| `default_defer_loading: true`, `search_method: NONE` | ✅ Added to tools | ❌ No |
| `default_defer_loading: false`, `search_method: BM25` | ❌ Not added | ❌ No |

### E2E Test Coverage

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
cd apps/backend
pnpm test src/lib/metamcp/e2e/tool-search-e2e.test.ts -- --grep "defer_loading Flag"
```

---

## Part 2: `SEARCH_ONLY` Mode (Strict Server-Side Filtering)

### Description

The `SEARCH_ONLY` mode provides **strict server-side filtering** that ONLY returns the search tool to clients. This is distinct from `defer_loading` which still returns all tools (with a flag).

**Key Difference:**
- **`defer_loading` (Part 1)**: Returns ALL tools with `defer_loading: true` flag. Relies on client support.
- **`SEARCH_ONLY` (Part 2)**: Returns ONLY the search tool. Works for ALL clients regardless of support.

### Configuration

| Setting | Location | Values |
|---------|----------|--------|
| `default_tool_visibility` | Namespace | `ALL` / `SEARCH_ONLY` |
| `override_tool_visibility` | Endpoint | `null` (inherit) / `ALL` / `SEARCH_ONLY` |

### Mode Comparison

| Mode | Tools Returned | Client Requirement | Context Savings |
|------|----------------|-------------------|-----------------|
| `ALL` | All tools (with `defer_loading` flag) | Smart client preferred | Moderate |
| `SEARCH_ONLY` | Only search tool | None (works for all) | Maximum (~90%+) |

### Implementation

```typescript
// Apply tool visibility filter
applyToolVisibilityFilter(tools: Tool[], config: ResolvedDeferLoadingConfig): Tool[] {
  if (config.toolVisibility === "SEARCH_ONLY") {
    // Only return the search tool
    return tools.filter((tool) => tool.name === TOOL_SEARCH_TOOL_NAME);
  }
  // ALL mode: return all tools
  return tools;
}
```

### E2E Test Coverage

**E2E Test 7: Tool Visibility Mode - SEARCH_ONLY (Part 2 - Strict Filtering)**

| Test Case | Description |
|-----------|-------------|
| `should only return search tool when toolVisibility is SEARCH_ONLY` | Verifies strict filtering |
| `should return empty array if search tool is not in list with SEARCH_ONLY` | Edge case handling |
| `should return all tools when toolVisibility is ALL` | Verifies ALL mode |
| `should resolve toolVisibility from namespace defaults` | Configuration inheritance |
| `should override namespace toolVisibility with endpoint setting` | Endpoint override |
| `should default to ALL when toolVisibility is not specified` | Default behavior |
| `should complete workflow: filtered list -> search -> discover -> invoke` | Full SEARCH_ONLY workflow |
| `should allow maximum context savings with SEARCH_ONLY mode` | Quantifies savings (>90%) |
| `should demonstrate the difference between defer_loading and SEARCH_ONLY` | Part 1 vs Part 2 comparison |

### How to Verify

```bash
cd apps/backend
pnpm test src/lib/metamcp/e2e/tool-search-e2e.test.ts -- --grep "SEARCH_ONLY"
```

---

## Part 3: Model Workflow (Legacy Client Support)

### Description

Even if a client doesn't support the `defer_loading` flag, the tool search feature remains fully functional. Models can:

1. See available tools (search tool, and optionally others based on visibility mode)
2. Use the search tool to discover relevant tools
3. Call discovered tools directly by name

### Workflow with SEARCH_ONLY Mode

```
┌─────────────────────────────────────────────────────────────────┐
│ Client connects to MetaMCP server                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Server returns tools/list response (SEARCH_ONLY mode):          │
│ - metamcp_search_tools                                          │
│ (All other tools are filtered out!)                             │
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
│ (Tool was not in original tools/list but can still be called!)  │
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
| `should complete full workflow: connect -> list tools -> search -> find -> invoke` | Complete workflow |
| `should work even when client does NOT support defer_loading` | Legacy client support |

### How to Verify

```bash
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
 ✓ src/lib/metamcp/e2e/tool-search-e2e.test.ts (50 tests) 29ms

 Test Files  1 passed (1)
      Tests  50 passed (50)
```

### Test Breakdown by Part

| Part | Test Suite | Tests |
|------|------------|-------|
| Part 1 | E2E Test 1: defer_loading Flag Conformance | 10 tests |
| Part 1 | E2E Test 2: Tool Filtering with defer_loading Enabled | 5 tests |
| Part 2 | E2E Test 6: Server-Side Middleware Processing | 8 tests |
| Part 2 | E2E Test 7: SEARCH_ONLY Mode (Strict Filtering) | 9 tests |
| Part 3 | E2E Test 3: Model Workflow | 11 tests |
| Supporting | E2E Test 4: Search Provider Integration | 4 tests |
| Supporting | E2E Test 5: Tool Reference Block Format | 3 tests |

---

## Configuration Reference

### Namespace Configuration

```typescript
interface NamespaceConfig {
  default_defer_loading: boolean;           // Enable/disable defer_loading flag
  default_search_method: SearchMethod;      // NONE | REGEX | BM25 | EMBEDDINGS
  default_tool_visibility?: ToolVisibilityMode; // ALL | SEARCH_ONLY (default: ALL)
}
```

### Endpoint Configuration

```typescript
interface EndpointConfig {
  override_defer_loading: DeferLoadingBehavior;    // INHERIT | ENABLED | DISABLED
  override_search_method: SearchMethod | 'INHERIT';
  override_tool_visibility?: ToolVisibilityMode | null; // null = inherit, ALL, SEARCH_ONLY
}
```

### Per-Tool Configuration

```typescript
// In namespace_tool_mappings table
{
  defer_loading: 'ENABLED' | 'DISABLED' | 'INHERIT'
}
```

### Configuration Priority

1. **Per-Tool Overrides** (highest priority)
2. **Endpoint Overrides** (if not INHERIT/null)
3. **Namespace Defaults** (lowest priority)

---

## Choosing the Right Mode

| Use Case | Recommended Mode | Reason |
|----------|-----------------|--------|
| Smart clients (Claude API, etc.) | Part 1: `defer_loading` with `ALL` visibility | Client handles deferred loading |
| Legacy clients | Part 2: `SEARCH_ONLY` | Maximum savings, no client support needed |
| Maximum context savings | Part 2: `SEARCH_ONLY` | ~90%+ reduction in initial tool list |
| Tool discoverability | Either | Both support search-based discovery |

---

## Files Reference

| File | Purpose |
|------|---------|
| `e2e/tool-search-e2e.test.ts` | E2E tests for all parts |
| `middleware/defer-loading.ts` | Core middleware with `applyToolVisibilityFilter` |
| `builtin-tools/tool-search-tool.ts` | Search tool definition and execution |
| `tool-search/regex-search-provider.ts` | REGEX search implementation |
| `tool-search/bm25-search-provider.ts` | BM25 search implementation |
| `metamcp-middleware/defer-loading.functional.ts` | Functional middleware wrapper |
| `metamcp-middleware/filter-tools.functional.ts` | Tool filtering middleware |

---

## Database Schema Changes

The following fields were added to support Part 2 (SEARCH_ONLY mode):

### Namespaces Table
```sql
default_tool_visibility tool_visibility_mode NOT NULL DEFAULT 'ALL'
```

### Endpoints Table
```sql
override_tool_visibility tool_visibility_mode
```

### New Enum
```sql
CREATE TYPE tool_visibility_mode AS ENUM ('ALL', 'SEARCH_ONLY');
```
