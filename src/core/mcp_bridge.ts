/**
 * core/mcp_bridge.ts — local stdio MCP gateway core.
 *
 * Architecture red lines (docs: unified AI interface):
 *   1. The remote /mcp endpoint is the ONLY authority. This bridge forwards
 *      every JSON-RPC message verbatim — it never hardcodes tool schemas, so
 *      tools/list stays single-sourced on the server (no drift).
 *   2. Zero business logic locally: no markup, no mapping, no caching
 *      decisions. Transport conversion + auth injection + logging only.
 *
 * Auth reuses the CLI credential store (auto-detected, same as every other
 * command): stored portal login or appKey/appSecret → ticket → Bearer. No new
 * secret storage. `--token` overrides for CI sandboxes.
 *
 * Protocol shape: MCP-over-stdio is newline-delimited JSON-RPC. The hosted
 * endpoint is stateless streamable-http (POST per message). Requests (with
 * `id`) yield exactly one response line; notifications yield none.
 */

import { loadProfile, type Profile } from "./config.ts";
import { authenticateOpenapi, authenticatePortal } from "./auth.ts";
import { HotelByteError } from "./http.ts";

export interface BridgeOptions {
  /** Remote /mcp endpoint; defaults to `<baseUrl>/mcp` of the active env. */
  url?: string;
  /** Bearer token override; defaults to the stored-credentials ticket. */
  token?: string;
  /** Per-request upstream timeout in ms (search fan-out is slow). */
  timeoutMs?: number;
}

/** Resolve the bearer ticket with the same profile preference as makeClient. */
export async function getBearerTicket(env: string): Promise<{ token: string; profile: Profile }> {
  const portal = loadProfile("portal", env);
  if (portal.username || portal.ticket) {
    await authenticatePortal(portal);
    return { token: portal.ticket!, profile: portal };
  }
  const api = loadProfile("openapi", env);
  if (api.appKey || api.ticket) {
    await authenticateOpenapi(api);
    return { token: api.ticket!, profile: api };
  }
  throw new HotelByteError(
    401,
    "No credentials found. Run:\n" +
      "  hbcli auth set-credentials --app-key YOUR_KEY --app-secret YOUR_SECRET  (API key mode)\n" +
      "  hbcli auth login --username admin@example.com                          (portal mode)",
    "mcp",
  );
}

export function resolveEndpoint(profile: Profile, override?: string): string {
  if (override) return override;
  return `${profile.baseUrl.replace(/\/+$/, "")}/mcp`;
}

/** One forwarded stdin line → zero or more stdout lines. */
export async function forwardLine(
  endpoint: string,
  token: string,
  line: string,
  timeoutMs = 120_000,
): Promise<string[]> {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let msg: any;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    // Not JSON-RPC: ignore silently — stdio noise must not corrupt the channel.
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": `Bearer ${token}`,
      },
      body: trimmed,
      signal: controller.signal,
    });
  } catch (e: any) {
    return [rpcError(msg, `mcp gateway upstream unreachable: ${e?.message ?? e}`)];
  } finally {
    clearTimeout(timer);
  }

  const text = await resp.text();

  if (!resp.ok) {
    return [rpcError(msg, `mcp gateway upstream ${resp.status}: ${text.slice(0, 300)}`)];
  }
  if (!text) return []; // 202/204 for notifications

  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    // SSE body: forward every data: payload as its own stdout line.
    return text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
  }
  return [text.trim()].filter(Boolean);
}

/** JSON-RPC error response bound to the request's id (notifications get none). */
function rpcError(reqMsg: any, message: string): string {
  const id = reqMsg && typeof reqMsg === "object" && "id" in reqMsg ? reqMsg.id : null;
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code: -32001, message },
  });
}

/**
 * Pump an async line source into the bridge and write outputs to `write`.
 * Kept generator/sink-shaped so tests drive it in memory; the CLI command
 * wires stdin/stdout. Sequential on purpose: preserves client ordering and
 * matches the stateless one-POST-per-message server contract.
 */
export async function runStdioBridge(
  endpoint: string,
  token: string,
  lines: AsyncIterable<string>,
  write: (line: string) => void,
  log: (msg: string) => void,
  timeoutMs?: number,
): Promise<void> {
  for await (const line of lines) {
    let outputs: string[];
    try {
      outputs = await forwardLine(endpoint, token, line, timeoutMs);
    } catch (e: any) {
      log(`mcp bridge: forward failed: ${e?.message ?? e}`);
      continue;
    }
    for (const out of outputs) {
      try {
        JSON.parse(out); // guard: never write a non-JSON line into the channel
        write(out);
      } catch {
        log(`mcp bridge: dropped non-JSON upstream payload: ${out.slice(0, 120)}`);
      }
    }
  }
}
