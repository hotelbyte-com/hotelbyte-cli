/**
 * core/api_catalog.ts — L0 generic passthrough catalog (issue #29).
 *
 * The portal surface is 1912 methods / 72 services behind one reflective
 * route (POST /api/:domain/:service/:method). Instead of hand-writing a
 * subcommand per endpoint, this module provides the discovery + guard
 * primitives shared by `hbcli api catalog/describe/call` and the local MCP
 * tools (docs/portal-cli-mcp-architecture.md):
 *
 *   fetchCatalog      raw pull of the server endpoint catalog
 *   loadCatalog       24h-cached wrapper with offline fallback
 *   isWriteOperation  write/read classification for the --confirm guard
 *   normalizeApiPath  "a/b/c" → "/api/a/b/c"; only /api/ targets are legal
 *   findMethodMeta    resolve "/api/a/b/c" or "service/method" to a catalog row
 *
 * Deliberately decoupled from src/commands/* — the MCP local tools (and the
 * tests) consume this module without importing the command layer. Callers
 * inject their own authenticated client factory.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { staicliHome } from "./config.ts";
import { HttpClient, HotelByteError } from "./http.ts";

// ── catalog types ───────────────────────────────────────────────────────

/** Mirrors the server-side MethodMeta (hotel-be build/api/asthelper). */
export interface MethodMeta {
  serviceName: string;
  methodName: string;
  /** Server-resolved full path, e.g. "/api/trade/tenant/listOrder". */
  path: string;
  authMethod?: string;
  permissions?: string[];
  paramNames?: string[];
  apidoc?: string;
  operationType?: string;
  validations?: unknown[];
}

/**
 * Minimal context for catalog consumers. The command layer passes
 * `{ env: ctx.env, client: () => makeClient(ctx) }`; anything that can
 * produce an authenticated HttpClient (MCP tools, tests) works too.
 */
export interface ApiCatalogCtx {
  env: () => string;
  client: () => Promise<HttpClient>;
}

export const CATALOG_ENDPOINT = "/api/view/getApiPaths";
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000; // 24h freshness window

// ── cache ───────────────────────────────────────────────────────────────

interface CatalogCache {
  /** Epoch ms of the pull that produced `methods`. */
  fetchedAt: number;
  methods: MethodMeta[];
}

export function catalogCachePath(env: string): string {
  return join(staicliHome(), `api-catalog-${env}.json`);
}

function readCache(env: string): CatalogCache | null {
  const file = catalogCachePath(env);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && Array.isArray(parsed.methods) && typeof parsed.fetchedAt === "number") {
      return parsed as CatalogCache;
    }
  } catch {
    // Corrupt cache file = cache miss; a fresh pull will rewrite it.
  }
  return null;
}

function writeCache(env: string, methods: MethodMeta[]): CatalogCache {
  const cache: CatalogCache = { fetchedAt: Date.now(), methods };
  mkdirSync(staicliHome(), { recursive: true });
  writeFileSync(catalogCachePath(env), JSON.stringify(cache));
  return cache;
}

// ── fetch ───────────────────────────────────────────────────────────────

/**
 * Pull the full endpoint catalog from the server.
 * type="" + limit=0 = every method of every service (live-verified
 * 2026-10-03, docs/portal-cli-mcp-architecture.md §2; demo ticket suffices).
 */
export async function fetchCatalog(ctx: ApiCatalogCtx): Promise<MethodMeta[]> {
  const client = await ctx.client();
  const resp = await client.post<unknown>(CATALOG_ENDPOINT, { type: "", limit: 0 });
  if (!Array.isArray(resp)) {
    throw new HotelByteError(
      500,
      `unexpected ${CATALOG_ENDPOINT} response: expected an array of method metadata`,
      CATALOG_ENDPOINT,
    );
  }
  return resp as MethodMeta[];
}

export interface CatalogSnapshot {
  methods: MethodMeta[];
  /** Epoch ms of the data being served (network pull or cache write). */
  fetchedAt: number;
  source: "network" | "cache";
  /** True when the cache was served past its TTL / after a fetch failure. */
  stale: boolean;
}

/**
 * Catalog with a 24h cache ($STAICLI_HOME/api-catalog-<env>.json) and an
 * offline fallback: when a pull fails (no credentials, network down) the
 * cached copy is served with a stderr note — any age beats no catalog.
 */
export async function loadCatalog(ctx: ApiCatalogCtx, opts: { refresh?: boolean } = {}): Promise<CatalogSnapshot> {
  const env = ctx.env();
  const cached = readCache(env);

  if (!opts.refresh && cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) {
    return { methods: cached.methods, fetchedAt: cached.fetchedAt, source: "cache", stale: false };
  }

  try {
    const methods = await fetchCatalog(ctx);
    const saved = writeCache(env, methods);
    return { methods: saved.methods, fetchedAt: saved.fetchedAt, source: "network", stale: false };
  } catch (e: any) {
    if (cached) {
      console.error(
        `note: catalog fetch failed (${e?.message ?? e}); using cached copy from ${new Date(cached.fetchedAt).toISOString()}`,
      );
      return { methods: cached.methods, fetchedAt: cached.fetchedAt, source: "cache", stale: true };
    }
    throw e;
  }
}

// ── write/read classification (guard primitives) ────────────────────────

// operationType missing → method-name prefix heuristic (case-insensitive);
// anything not on this list is treated as a write (default-deny).
const READ_METHOD_PREFIXES = [
  "get", "list", "search", "query", "count", "detail", "find",
  "stat", "read", "dashboard", "page", "metadata",
];

export function isWriteOperation(meta: Pick<MethodMeta, "operationType" | "methodName">): boolean {
  if (meta.operationType === "write") return true;
  if (meta.operationType === "read") return false;
  const name = (meta.methodName ?? "").toLowerCase();
  return !READ_METHOD_PREFIXES.some((p) => name.startsWith(p));
}

// ── path handling ───────────────────────────────────────────────────────

// Out of scope for the JSON passthrough (architecture D6): internal routes,
// webhooks, and /uploads static assets get dedicated L1 commands, never `api call`.
const EXCLUDED_API_PREFIXES = ["/api/internal", "/api/webhook", "/api/uploads"];

/**
 * Normalize an endpoint reference to a full path: "a/b/c" → "/api/a/b/c".
 * Only /api/ JSON endpoints are legal targets; internal/webhook/uploads
 * paths are rejected with an explicit error.
 */
export function normalizeApiPath(input: string): string {
  const raw = input.trim();
  if (!raw) throw new HotelByteError(400, "api path is empty", "api");
  if (raw.includes("://")) {
    throw new HotelByteError(
      400,
      `"${raw}" is a full URL; pass only the /api/ path (e.g. api call a/b/c)`,
      "api",
    );
  }
  let candidate = raw;
  if (!candidate.startsWith("/")) {
    candidate = candidate.startsWith("api/") ? `/${candidate}` : `/api/${candidate}`;
  }
  if (!candidate.startsWith("/api/")) {
    throw new HotelByteError(
      400,
      `"${raw}" is not a /api/ JSON endpoint (api call only targets /api/:domain/:service/:method; internal/webhook/uploads are out of scope)`,
      "api",
    );
  }
  const lower = candidate.toLowerCase();
  for (const prefix of EXCLUDED_API_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}/`)) {
      throw new HotelByteError(
        400,
        `"${raw}" is out of scope for api call (${prefix}/* is not a JSON passthrough endpoint)`,
        "api",
      );
    }
  }
  return candidate;
}

/** Last path segment — the method name for reflective routes. */
export function methodNameFromPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

/**
 * Resolve a describe/call target to its catalog row. Both forms accepted:
 * a full path ("/api/a/b/c" or "a/b/c") and "service/method" — a @path
 * override can make the deployed path differ from service/method, so the
 * path form wins when both match different rows.
 */
export function findMethodMeta(methods: MethodMeta[], target: string): MethodMeta | undefined {
  const raw = target.trim().toLowerCase();
  if (!raw) return undefined;
  let pathForm: string | null = null;
  try {
    pathForm = normalizeApiPath(target).toLowerCase();
  } catch {
    pathForm = null; // out-of-scope targets simply have no catalog row
  }
  const byPath = pathForm ? methods.find((m) => (m.path ?? "").toLowerCase() === pathForm) : undefined;
  if (byPath) return byPath;
  return methods.find((m) => `${m.serviceName}/${m.methodName}`.toLowerCase() === raw);
}
