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

import { loadProfile, type Profile } from "../core/config.ts";
import { HttpClient, HotelByteError } from "../core/http.ts";
import { authenticateOpenapi, authenticatePortal } from "../core/auth.ts";
import { emit, error } from "../utils/output.ts";

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
 *   1. portal profile with a valid cached ticket → use portal (admin context)
 *   2. openapi profile (appKey/appSecret or cached ticket) → use openapi
 *   3. portal profile but portal login unavailable or yields no usable ticket →
 *      fall back to openapi rather than sending an invalid bearer token
 *      (this was the source of false-positive 401s against @permission: openapi endpoints).
 */
export async function makeClient(ctx: Ctx): Promise<HttpClient> {
  const env = ctx.env();
  const portalProfile = loadProfile("portal", env);
  const apiProfile = loadProfile("openapi", env);

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

  throw new HotelByteError(
    401,
    "No credentials found. Run:\n" +
      "  hbcli auth set-credentials --app-key YOUR_KEY --app-secret YOUR_SECRET  (API key mode)\n" +
      "  hbcli auth login --username admin@example.com                          (portal mode)\n" +
      "Or set env vars: HOTELBYTE_APP_KEY/HOTELBYTE_APP_SECRET, HOTELBYTE_USERNAME/HOTELBYTE_PASSWORD",
    "auth",
  );
}

/**
 * Run a POST request with auto-auth, emit the result.
 */
export async function run(ctx: Ctx, path: string, body: any): Promise<void> {
  try {
    const client = await makeClient(ctx);
    const resp = await client.post(path, body);
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
    return JSON.parse(Bun.file(value.slice(1)).textSync());
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
