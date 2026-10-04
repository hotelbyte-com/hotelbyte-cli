/**
 * core/mcp_local.ts — local stdio MCP tool server (issue #30, architecture D4/D5).
 *
 * `hbcli mcp serve --local` runs THIS instead of the remote bridge: a
 * self-contained JSON-RPC 2.0 server on stdin/stdout exposing three GENERIC
 * tools (no domain tool schema is hardcoded here — domain schemas stay
 * single-sourced on the hosted gateway, per the architecture's
 * "don't duplicate the two faces" rule) plus ONE deliberate exception, the
 * public unauthenticated presales agent (see docs D4 note, issue #45):
 *
 *   portal.catalog   search the endpoint catalog (filter/service/limit)
 *   portal.describe  full metadata for one endpoint
 *   portal.call      authed POST to any /api/ JSON endpoint
 *   presales.chat    public landing-page advisor (no credentials; SSE in,
 *                    aggregated text out)
 *
 * Discovery/classification/auth reuse core/api_catalog.ts (getApiPaths is the
 * only authority) and the CLI credential store via the caller-injected client
 * factory — same getBearerTicket logic as the bridge (demo/portal/openapi).
 *
 * Protocol contract (newline-delimited JSON-RPC over stdio):
 *   - initialize echoes the client protocolVersion + capabilities/serverInfo
 *   - notifications (no `id`) never get a response
 *   - ping → {}
 *   - unknown method → -32601; malformed/non-JSON input → stderr note, no reply
 *   - tool failures are TOOL-level errors (result.isError=true), never
 *     protocol-level ones — only JSON-RPC framing problems use error objects
 *   - stdout carries protocol only; every diagnostic goes to the `log` sink
 */

import {
  effectiveOperationType,
  findMethodMeta,
  isWriteOperation,
  loadCatalog,
  methodNameFromPath,
  normalizeApiPath,
  type ApiCatalogCtx,
  type MethodMeta,
} from "./api_catalog.ts";
import { streamPresalesChat } from "./presales.ts";
import { VERSION } from "./version.ts";

export const LOCAL_MCP_SERVER_NAME = "hotelbyte-portal";
/** Answered when the client sends no protocolVersion (current MCP spec). */
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
export const DEFAULT_CATALOG_LIMIT = 50;
export const MAX_CATALOG_LIMIT = 1000;

export interface LocalMcpOptions {
  /** Authenticated client factory (getBearerTicket → HttpClient at the command layer). */
  ctx: ApiCatalogCtx;
  /** Diagnostic sink (stderr in the CLI; captured in tests). */
  log?: (msg: string) => void;
}

// ── tool surface ────────────────────────────────────────────────────────

/** The three generic tools — stable surface, zero domain schemas (D4) — plus
 * the one public-surface exception (presales.chat, D4 note / issue #45). */
export const LOCAL_TOOLS = [
  {
    name: "portal.catalog",
    description:
      "Search the HotelByte portal endpoint catalog (every /api/ JSON endpoint). " +
      "Returns compact rows (path/service/method/operationType); use portal.describe for full metadata. " +
      "operationType \"write (heuristic)\"/\"read (heuristic)\" means the server did not classify it and the method-name heuristic decided.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Case-insensitive substring matched against path/service/method" },
        service: { type: "string", description: "Exact service name filter (case-insensitive)" },
        limit: { type: "integer", minimum: 1, maximum: MAX_CATALOG_LIMIT, description: `Max rows returned (default ${DEFAULT_CATALOG_LIMIT}; total is always reported)` },
      },
      additionalProperties: false,
    },
  },
  {
    name: "portal.describe",
    description:
      "Full metadata for one portal endpoint: params, permissions, auth, apidoc, plus isWrite " +
      "(the exact classification portal.call enforces). Accepts \"/api/a/b/c\", \"a/b/c\", or \"service/method\".",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Endpoint reference: \"/api/a/b/c\", \"a/b/c\", or \"service/method\"" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "portal.call",
    description:
      "Authed POST to any /api/ JSON endpoint (server-side RBAC applies as-is). " +
      "Write operations — catalog operationType=write, or a method name that does not start with a read prefix — " +
      "are rejected unless confirm=true.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Endpoint to call: \"/api/a/b/c\" or \"a/b/c\"" },
        data: { type: "object", description: "Request body JSON object (default {})" },
        confirm: { type: "boolean", description: "Explicit confirmation for write operations; required true or the call is rejected" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "presales.chat",
    description:
      "Public pre-sales AI advisor (landing-page agent — NO credentials needed, works without login). " +
      "Sends one visitor message and returns the aggregated A2UI v0.9 SSE event text. " +
      "Server rate-limits per IP/visitor; a 429 is surfaced as a tool error, not retried.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Visitor message" },
        locale: { type: "string", description: "Content locale (server default: zh)" },
        pageContext: { type: "string", description: "Landing page path the visitor is on (server default: /)" },
        sessionId: { type: "string", description: "Continue an existing chat session (multi-turn context)" },
        visitorId: { type: "string", description: "Stable visitor identifier (session continuity + rate-limit key)" },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
] as const;

// ── JSON-RPC plumbing ───────────────────────────────────────────────────

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function rpcResult(id: unknown, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// ── tool execution ──────────────────────────────────────────────────────

/** MCP tool output: text content plus the tool-level error flag. */
interface ToolOutput {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function toolOk(payload: unknown): ToolOutput {
  return { content: [{ type: "text", text: JSON.stringify(payload === undefined ? null : payload) }] };
}

function toolError(message: string): ToolOutput {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

/** Surface API/auth errors as tool errors with their real message (never swallow). */
function toolErrorFrom(e: unknown): ToolOutput {
  const msg = e instanceof Error ? e.message : String(e);
  return toolError(msg);
}

async function toolCatalog(params: Record<string, unknown>, opts: LocalMcpOptions): Promise<ToolOutput> {
  const filter = params.filter;
  const service = params.service;
  if (filter !== undefined && typeof filter !== "string") return toolError("filter must be a string");
  if (service !== undefined && typeof service !== "string") return toolError("service must be a string");

  let limit = DEFAULT_CATALOG_LIMIT;
  if (params.limit !== undefined) {
    if (typeof params.limit !== "number" || !Number.isInteger(params.limit) || params.limit < 1) {
      return toolError("limit must be a positive integer");
    }
    if (params.limit > MAX_CATALOG_LIMIT) return toolError(`limit must be ≤ ${MAX_CATALOG_LIMIT}`);
    limit = params.limit;
  }

  let snapshot: Awaited<ReturnType<typeof loadCatalog>>;
  try {
    snapshot = await loadCatalog(opts.ctx);
  } catch (e) {
    return toolErrorFrom(e);
  }

  let methods = snapshot.methods;
  if (service) {
    const svc = service.toLowerCase();
    methods = methods.filter((m) => (m.serviceName ?? "").toLowerCase() === svc);
  }
  if (filter) {
    const needle = filter.toLowerCase();
    methods = methods.filter((m) =>
      `${m.path ?? ""} ${m.serviceName ?? ""} ${m.methodName ?? ""}`.toLowerCase().includes(needle)
    );
  }

  const rows = methods.map((m) => ({
    path: m.path ?? "",
    service: m.serviceName ?? "",
    method: m.methodName ?? "",
    operationType: effectiveOperationType(m),
  }));
  return toolOk({
    total: rows.length,
    returned: Math.min(limit, rows.length),
    source: snapshot.source,
    fetchedAt: snapshot.fetchedAt,
    methods: rows.slice(0, limit),
  });
}

async function toolDescribe(params: Record<string, unknown>, opts: LocalMcpOptions): Promise<ToolOutput> {
  if (typeof params.path !== "string" || !params.path.trim()) {
    return toolError('path is required (e.g. "trade/tenant/listOrder", "/api/trade/tenant/listOrder", or "service/method")');
  }
  let meta: MethodMeta | undefined;
  try {
    meta = findMethodMeta((await loadCatalog(opts.ctx)).methods, params.path);
  } catch (e) {
    return toolErrorFrom(e);
  }
  if (!meta) {
    return toolError(`endpoint "${params.path}" not found in the catalog (try portal.catalog with a filter)`);
  }
  return toolOk({ ...meta, isWrite: isWriteOperation(meta) });
}

async function toolCall(params: Record<string, unknown>, opts: LocalMcpOptions): Promise<ToolOutput> {
  if (typeof params.path !== "string" || !params.path.trim()) {
    return toolError('path is required (e.g. "trade/tenant/listOrder" or "/api/trade/tenant/listOrder")');
  }
  if (params.data !== undefined && !isPlainObject(params.data)) {
    return toolError("data must be a JSON object");
  }
  const confirmed = params.confirm === true;

  let target: string;
  try {
    target = normalizeApiPath(params.path);
  } catch (e) {
    return toolErrorFrom(e);
  }
  const body = (params.data ?? {}) as Record<string, unknown>;

  // Write guard (D5, same shape as `api call`): confirm=true short-circuits
  // the classification (and its catalog lookup) entirely; otherwise classify
  // from the catalog when available and fall back to the name heuristic.
  if (!confirmed) {
    let meta: MethodMeta | undefined;
    try {
      meta = findMethodMeta((await loadCatalog(opts.ctx)).methods, target);
    } catch (e) {
      const reason = String(e instanceof Error ? e.message : e).split("\n")[0];
      opts.log?.(`mcp local: catalog unavailable (${reason}); classifying "${target}" by method-name heuristic`);
    }
    const probe = { operationType: meta?.operationType, methodName: meta?.methodName ?? methodNameFromPath(target) };
    if (isWriteOperation(probe)) {
      const basis = probe.operationType
        ? `operationType=${probe.operationType}`
        : `method name "${probe.methodName}" is not on the read-prefix list`;
      return toolError(`${target} looks like a WRITE operation (${basis}). Re-send with confirm=true to execute.`);
    }
  }

  try {
    const client = await opts.ctx.client();
    const resp = await client.post(target, body);
    return toolOk(resp);
  } catch (e) {
    return toolErrorFrom(e);
  }
}

/**
 * presales.chat (issue #45): the one public domain tool on the local face.
 * Aggregates the A2UI SSE events into {events, text}; no credentials touched.
 */
async function toolPresalesChat(params: Record<string, unknown>, opts: LocalMcpOptions): Promise<ToolOutput> {
  if (typeof params.message !== "string" || !params.message.trim()) {
    return toolError("message is required (the visitor's question for the pre-sales advisor)");
  }
  const events: string[] = [];
  try {
    await streamPresalesChat(opts.ctx.env(), {
      message: params.message,
      locale: typeof params.locale === "string" ? params.locale : undefined,
      pageContext: typeof params.pageContext === "string" ? params.pageContext : undefined,
      sessionId: typeof params.sessionId === "string" ? params.sessionId : undefined,
      visitorId: typeof params.visitorId === "string" ? params.visitorId : undefined,
    }, (data) => events.push(data));
  } catch (e) {
    return toolErrorFrom(e);
  }
  return toolOk({ events: events.length, text: events.join("\n") });
}

async function callTool(name: unknown, params: unknown, opts: LocalMcpOptions): Promise<ToolOutput> {
  if (!isPlainObject(params)) return toolError("params must be a JSON object");
  switch (name) {
    case "portal.catalog": return toolCatalog(params, opts);
    case "portal.describe": return toolDescribe(params, opts);
    case "portal.call": return toolCall(params, opts);
    case "presales.chat": return toolPresalesChat(params, opts);
    default: return toolError(`unknown tool "${String(name)}" (available: portal.catalog, portal.describe, portal.call, presales.chat)`);
  }
}

// ── message dispatch ────────────────────────────────────────────────────

/**
 * One parsed JSON-RPC message → its response object, or null when the message
 * must stay unanswered (notifications, malformed frames).
 */
export async function dispatchLocalMessage(msg: unknown, opts: LocalMcpOptions): Promise<JsonRpcResponse | null> {
  if (!isPlainObject(msg)) {
    // Not a JSON-RPC frame (number/array/string): tolerated, never answered.
    opts.log?.(`mcp local: ignored non-object JSON-RPC frame: ${JSON.stringify(msg).slice(0, 120)}`);
    return null;
  }
  // A message without `id` is a notification — notifications get no response.
  if (!("id" in msg)) return null;

  if (typeof msg.method !== "string") {
    return rpcError(msg.id, -32600, "invalid request: missing method");
  }

  switch (msg.method) {
    case "initialize": {
      const params = isPlainObject(msg.params) ? msg.params : {};
      const clientVersion = typeof params.protocolVersion === "string" && params.protocolVersion
        ? params.protocolVersion
        : DEFAULT_PROTOCOL_VERSION;
      return rpcResult(msg.id, {
        protocolVersion: clientVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: LOCAL_MCP_SERVER_NAME, version: VERSION },
      });
    }
    case "ping":
      return rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, { tools: LOCAL_TOOLS });
    case "tools/call": {
      // MCP tools/call params: { name: string, arguments?: object } — the tool
      // handlers receive only the arguments object.
      const p = isPlainObject(msg.params) ? msg.params : {};
      return rpcResult(msg.id, await callTool(p.name, p.arguments ?? {}, opts));
    }
    default:
      return rpcError(msg.id, -32601, `method not found: ${msg.method}`);
  }
}

/**
 * One raw stdin line → the serialized response line, or null when nothing
 * may be written (empty line, non-JSON noise, notification).
 */
export async function handleLocalLine(line: string, opts: LocalMcpOptions): Promise<string | null> {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let msg: unknown;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    // Non-JSON stdin noise must not corrupt the channel: note on stderr, stay silent on stdout.
    opts.log?.(`mcp local: ignored non-JSON stdin line: ${trimmed.slice(0, 120)}`);
    return null;
  }

  try {
    const resp = await dispatchLocalMessage(msg, opts);
    return resp === null ? null : JSON.stringify(resp);
  } catch (e) {
    // Defensive: a handler bug must not kill the server — answer with -32603.
    const id = isPlainObject(msg) && "id" in msg ? msg.id : null;
    opts.log?.(`mcp local: internal error: ${e instanceof Error ? e.message : String(e)}`);
    return JSON.stringify(rpcError(id, -32603, `internal error: ${e instanceof Error ? e.message : String(e)}`));
  }
}

/**
 * Pump an async line source through the local server and write each response
 * line to `write` (generator/sink-shaped like runStdioBridge so tests drive
 * it in memory; the CLI command wires stdin/stdout). Exits cleanly at EOF.
 */
export async function runLocalMcpServer(
  lines: AsyncIterable<string>,
  write: (line: string) => void,
  opts: LocalMcpOptions,
): Promise<void> {
  for await (const line of lines) {
    const out = await handleLocalLine(line, opts);
    if (out !== null) write(out);
  }
}
