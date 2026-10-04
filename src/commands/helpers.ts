/**
 * commands/helpers.ts — shared client builder with auto-auth.
 *
 * The CLI flattens two auth modes into one seamless experience:
 *   1. If API key credentials exist → authenticate via /api/auth/ticket
 *   2. If portal credentials exist  → authenticate via /api/auth/login
 *   3. If both exist                → prefer portal (admin context)
 *   4. If neither                   → error with guidance
 *
 * The backend RBAC system + audience-scoped service variants handle
 * which data the caller can see. The CLI doesn't need to expose that
 * distinction to the user.
 */

import { loadProfile, clearTicket, clearMockSession, loadMockSession, type Profile } from "../core/config.ts";
import { HttpClient, HotelByteError } from "../core/http.ts";
import { authenticateOpenapi, authenticatePortal } from "../core/auth.ts";
import { emit, error } from "../utils/output.ts";
import { readFileSync } from "node:fs";

export type Ctx = { jsonMode: () => boolean; env: () => string };

// A literal "stored-ticket" placeholder was historically saved before portal login completed.
// Treat it as no ticket so authenticatePortal actually re-issues one.
function isUsableTicket(t: string | undefined): boolean {
  return !!t && t !== "stored-ticket";
}

/**
 * Build an authenticated HttpClient.
 * Auto-detects auth mode from stored credentials.
 *
 * Auth precedence:
 *   0. active view-as (mock) session → use the impersonation ticket; commands
 *      run as the target user until `auth mock-exit` (issue #44)
 *   1. portal profile with a valid cached ticket → use portal (admin context)
 *   2. openapi profile (appKey/appSecret or cached ticket) → use openapi
 *   3. portal profile but portal login unavailable or yields no usable ticket →
 *      fall back to openapi rather than sending an invalid bearer token
 *      (this was the source of false-positive 401s against @permission: openapi endpoints).
 */
export async function makeClient(ctx: Ctx): Promise<HttpClient> {
  const env = ctx.env();

  // View-as impersonation (issue #44): outranks every local identity — the
  // whole point is running commands as the target user. loadMockSession reads
  // the store only, so HOTELBYTE_TOKEN cannot fake an active session.
  const mock = loadMockSession(env);
  if (mock) {
    // loadProfile only for baseUrl resolution (env overrides stay single-sourced).
    return new HttpClient({ ...loadProfile("mock", env), ticket: mock.ticket });
  }

  const portalProfile = loadProfile("portal", env);
  const apiProfile = loadProfile("openapi", env);
  const customerProfile = loadProfile("customer", env);

  const hasOpenapi = !!(apiProfile.appKey || isUsableTicket(apiProfile.ticket));
  const hasPortalCreds = !!(portalProfile.username || isUsableTicket(portalProfile.ticket));

  // Prefer portal if it has a usable ticket cached.
  if (hasPortalCreds && isUsableTicket(portalProfile.ticket)) {
    return new HttpClient(portalProfile);
  }

  // Try portal auth only if creds exist but ticket isn't usable yet.
  if (hasPortalCreds && !isUsableTicket(portalProfile.ticket)) {
    try {
      await authenticatePortal(portalProfile);
      if (isUsableTicket(portalProfile.ticket)) {
        return new HttpClient(portalProfile);
      }
    } catch {
      // Fall through to openapi fallback.
    }
  }

  if (hasOpenapi) {
    await authenticateOpenapi(apiProfile);
    return new HttpClient(apiProfile);
  }

  // Customer session (C 端, advisor 的客户): lowest precedence — a one-shot
  // email code is the only credential, so there is no re-auth path; use the
  // cached ticket when no portal/openapi credentials exist.
  if (isUsableTicket(customerProfile.ticket)) {
    return new HttpClient(customerProfile);
  }

  throw new HotelByteError(
    401,
    "No credentials found. Run:\n" +
      "  hbcli auth set-credentials --app-key YOUR_KEY --app-secret YOUR_SECRET  (API key mode)\n" +
      "  hbcli auth login --username admin@example.com                          (portal mode)\n" +
      "  hbcli auth register --email you@corp.com ...                           (register a new tenant)\n" +
      "  hbcli auth customer-login --email guest@mail.com --code 123456         (customer mode)\n" +
      "Or set env vars: HOTELBYTE_APP_KEY/HOTELBYTE_APP_SECRET, HOTELBYTE_USERNAME/HOTELBYTE_PASSWORD",
    "auth",
  );
}

/**
 * Run `attempt` with auto-auth, retrying once on stale-ticket 401 (HTTP status
 * or biz code 100000401 — http.ts surfaces both as HotelByteError.status):
 * cached ST tickets are short-lived, and a stale ticket used verbatim produced
 * hard-to-diagnose "authentication denied" failures (issue #142 follow-up).
 * Shared by the JSON (`run`), raw-byte and multipart channels.
 */
export async function withAuthRetry<T>(ctx: Ctx, attempt: (client: HttpClient) => Promise<T>): Promise<T> {
  try {
    return await attempt(await makeClient(ctx));
  } catch (e: any) {
    const stale = e instanceof HotelByteError && (e.status === 401 || e.status === 1_00_00_0401);
    if (!stale) throw e;
    // Stale view-as session: drop ticket AND metadata so the retry falls back
    // to the caller's own identity (issue #44).
    clearMockSession(ctx.env());
    clearTicket("openapi", ctx.env());
    clearTicket("portal", ctx.env());
    return attempt(await makeClient(ctx));
  }
}

/**
 * Run a POST request with auto-auth, emit the result.
 */
export async function run(ctx: Ctx, path: string, body: any): Promise<void> {
  try {
    const resp = await withAuthRetry(ctx, (client) => client.post(path, body));
    emit(resp, ctx.jsonMode());
  } catch (e: any) {
    if (e instanceof HotelByteError) {
      error(e.message, ctx.jsonMode());
      process.exit(1);
    }
    throw e;
  }
}

/**
 * Parse a JSON string or @file.json path into a JS object.
 */
export function parseJsonInput(value: string): unknown {
  if (value.startsWith("@")) {
    return JSON.parse(readFileSync(value.slice(1), "utf8"));
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
