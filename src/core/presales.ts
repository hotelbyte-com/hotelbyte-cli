/**
 * core/presales.ts — public pre-sales agent surface (issue #45).
 *
 * /api/public/presales/* are UNAUTHENTICATED by contract (hotel-be
 * agent/packs/presalesagent/handler.go; routes.go:349): no ticket, no
 * three-tier identity. The client is built from a bare baseUrl-only profile —
 * "public" is a carrier for baseUrl resolution and is never persisted.
 *
 *   chat     POST /api/public/presales/chat   {sessionId?, visitorId?, message,
 *            locale?, pageContext?} → SSE stream of A2UI v0.9 events
 *   feedback POST /api/public/presales/feedback {visitorId?, sessionId?, email,
 *            company?, name?, messageType: lead|demo_request|human_handoff,
 *            message?, context?, locale?} → {success, message} (plain JSON,
 *            no {code,data} envelope — the handler writes the struct directly)
 *
 * Server-side rate limits (per IP + per visitor) surface as 429 with
 * {"error":"too many requests, please try again later"} — surfaced verbatim,
 * never retried or swallowed.
 */

import type { Profile } from "./config.ts";
import { DEFAULT_ENV, ENVIRONMENTS } from "./config.ts";
import { HttpClient, HotelByteError } from "./http.ts";

/** Bare profile for the public surface: baseUrl only, never a credential. */
export function publicPresalesProfile(env: string): Profile {
  return {
    name: "public",
    env,
    baseUrl: process.env.HOTELBYTE_BASE_URL ?? ENVIRONMENTS[env] ?? ENVIRONMENTS[DEFAULT_ENV],
  };
}

export interface PresalesChatInput {
  message: string;
  locale?: string;
  pageContext?: string;
  sessionId?: string;
  visitorId?: string;
}

export interface PresalesFeedbackInput {
  email: string;
  messageType: "lead" | "demo_request" | "human_handoff";
  name?: string;
  company?: string;
  message?: string;
  context?: string;
  locale?: string;
  sessionId?: string;
  visitorId?: string;
}

/**
 * Stream one presales chat turn. `onData` receives each SSE `data:` payload
 * verbatim, in arrival order (A2UI v0.9 events are heterogeneous).
 */
export async function streamPresalesChat(env: string, input: PresalesChatInput, onData: (data: string) => void): Promise<void> {
  if (!String(input.message ?? "").trim()) {
    throw new HotelByteError(400, "message is required", "/api/public/presales/chat");
  }
  // Wire contract (agent.go:66 PresalesChatReq): only provided optionals are sent.
  const body: Record<string, string> = { message: input.message };
  if (input.locale) body.locale = input.locale;
  if (input.pageContext) body.pageContext = input.pageContext;
  if (input.sessionId) body.sessionId = input.sessionId;
  if (input.visitorId) body.visitorId = input.visitorId;
  const client = new HttpClient(publicPresalesProfile(env));
  await client.postStream("/api/public/presales/chat", body, onData);
}

/** Submit a presales lead/feedback; resolves the plain {success, message} body. */
export async function sendPresalesFeedback(env: string, input: PresalesFeedbackInput): Promise<{ success?: boolean; message?: string }> {
  if (!String(input.email ?? "").trim()) {
    throw new HotelByteError(400, "email is required", "/api/public/presales/feedback");
  }
  // Wire contract (agent.go:75 PresalesFeedbackReq); backend defaults
  // messageType→lead / locale→zh when empty (handler.go:109-120).
  const body: Record<string, string> = { email: input.email, messageType: input.messageType };
  if (input.name) body.name = input.name;
  if (input.company) body.company = input.company;
  if (input.message) body.message = input.message;
  if (input.context) body.context = input.context;
  if (input.locale) body.locale = input.locale;
  if (input.sessionId) body.sessionId = input.sessionId;
  if (input.visitorId) body.visitorId = input.visitorId;
  const client = new HttpClient(publicPresalesProfile(env));
  return client.post("/api/public/presales/feedback", body);
}
