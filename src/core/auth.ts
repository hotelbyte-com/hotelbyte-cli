/**
 * auth.ts — authentication flows for both profiles.
 *
 * OpenAPI:  POST /api/auth/ticket  {appKey, appSecret} → {ticket}
 * Portal:   POST /api/auth/login    {email, password} → {ticket}
 *
 * Both flows cache the returned JWT ticket in the credential store.
 *
 * Registration & email-code flows (issue #14, both public @auth:false):
 *   Tenant (B 端):   sendOTP → registerTenant {email, password, tenantName, otpCode}
 *   Customer (C 端): sendCustomerLoginCode → loginByCustomerEmailCode {email, code}
 *                    (验证通过即登录；新邮箱即注册)
 */

import type { MockSession, Profile } from "./config.ts";
import { saveMockSession, saveProfile } from "./config.ts";
import { HttpClient, HotelByteError } from "./http.ts";

export function extractTicket(resp: any): string {
  if (resp && typeof resp === "object") {
    for (const key of ["ticket", "Ticket", "token", "access_token", "accessToken"]) {
      const val = resp[key];
      if (typeof val === "string" && val) return val;
    }
    const data = resp.data;
    if (data && typeof data === "object") {
      for (const key of ["ticket", "token", "access_token"]) {
        const val = data[key];
        if (typeof val === "string" && val) return val;
      }
    }
  }
  throw new HotelByteError(500, `Could not extract ticket from response: ${JSON.stringify(resp)}`, "auth");
}

export async function authenticateOpenapi(profile: Profile): Promise<string> {
  if (profile.ticket) return profile.ticket;
  if (!profile.appKey || !profile.appSecret) {
    throw new HotelByteError(
      401,
      "Missing appKey/appSecret. Set via --app-key/--app-secret, env HOTELBYTE_APP_KEY/HOTELBYTE_APP_SECRET, or 'hotelbyte-cli openapi auth set-credentials'.",
      "/api/auth/ticket",
    );
  }
  const client = new HttpClient(profile);
  const resp = await client.post("/api/auth/ticket", { appKey: profile.appKey, appSecret: profile.appSecret });
  const ticket = extractTicket(resp);
  profile.ticket = ticket;
  saveProfile(profile);
  return ticket;
}

export async function authenticatePortal(profile: Profile): Promise<string> {
  if (profile.ticket) return profile.ticket;
  if (!profile.username || !profile.password) {
    throw new HotelByteError(
      401,
      "Missing username/password. Set via --username/--password, env HOTELBYTE_USERNAME/HOTELBYTE_PASSWORD, or 'hbcli auth login'.",
      "/api/auth/login",
    );
  }
  const client = new HttpClient(profile);
  // Backend contract is {email, password} (hotel-be api/protocol/login.go LoginReq);
  // a username field is ignored server-side and login fails with "id and key can't be empty".
  const resp = await client.post("/api/auth/login", { email: profile.username, password: profile.password });
  const ticket = extractTicket(resp);
  profile.ticket = ticket;
  saveProfile(profile);
  return ticket;
}

// ── Registration & email-code flows (issue #14) ─────────────────────────
//
// All endpoints below are public (hotel-be @auth: false). Callers pass a
// bare Profile — baseUrl set, no ticket — so no Authorization header is sent.

export async function sendRegistrationOtp(profile: Profile, email: string): Promise<{ nextTime?: string; expiresIn?: number }> {
  const client = new HttpClient(profile);
  return client.post("/api/auth/sendOTP", { email });
}

export async function checkDomainAvailability(
  profile: Profile,
  email: string,
  domain?: string,
): Promise<{ available?: boolean; domain?: string }> {
  const client = new HttpClient(profile);
  const body: Record<string, string> = { email };
  if (domain) body.domain = domain;
  return client.post("/api/registration/checkDomainAvailability", body);
}

export interface RegisterTenantInput {
  email: string;
  password: string;
  tenantName: string;
  tenantDomain?: string;
  otpCode: string;
  interestedModules?: string[];
}

/**
 * Tenant self-registration (B 端). OTP code proves email ownership; the
 * backend returns an auto-login JWT which is stored as the portal profile
 * so portal commands work immediately after registration.
 */
export async function registerTenantAccount(profile: Profile, req: RegisterTenantInput): Promise<{ resp: any; token: string }> {
  // Mirror backend validation (hotel-be user/service/tenant_register.go) to
  // fail fast before burning the one-time OTP.
  if (!req.otpCode.trim()) {
    throw new HotelByteError(400, "otpCode is required", "/api/registration/registerTenant");
  }
  if (req.password.length < 8) {
    throw new HotelByteError(400, "password must be at least 8 characters", "/api/registration/registerTenant");
  }
  if (!req.tenantName.trim()) {
    throw new HotelByteError(400, "tenantName is required", "/api/registration/registerTenant");
  }
  const client = new HttpClient(profile);
  const resp = await client.post("/api/registration/registerTenant", {
    email: req.email,
    password: req.password,
    tenantName: req.tenantName,
    tenantDomain: req.tenantDomain,
    otpCode: req.otpCode,
    interestedModules: req.interestedModules,
  });
  const token = extractTicket(resp); // RegisterTenantResp.Token — extractTicket matches the "token" key
  profile.username = req.email;
  profile.password = req.password;
  profile.ticket = token;
  saveProfile(profile);
  return { resp, token };
}

export async function sendCustomerLoginCode(profile: Profile, email: string): Promise<{ nextTime?: string; expiresIn?: number }> {
  const client = new HttpClient(profile);
  return client.post("/api/auth/sendCustomerLoginCode", { email });
}

/**
 * Customer email-code login (C 端, advisor 的客户): OTP verified = logged in;
 * a new email is auto-registered as a Consumer user. The returned JWT is
 * stored as the "customer" profile (code is one-shot — no re-auth material).
 */
export async function loginByCustomerEmailCode(
  profile: Profile,
  req: { email: string; code: string; ttl?: number; attributionToken?: string },
): Promise<{ resp: any; token: string }> {
  if (!req.code.trim()) {
    throw new HotelByteError(400, "code is required", "/api/auth/loginByCustomerEmailCode");
  }
  const client = new HttpClient(profile);
  const resp = await client.post("/api/auth/loginByCustomerEmailCode", {
    email: req.email,
    code: req.code,
    ttl: req.ttl,
    attributionToken: req.attributionToken,
  });
  const token = extractTicket(resp);
  profile.username = req.email;
  profile.ticket = token;
  saveProfile(profile);
  return { resp, token };
}

// ── View-as impersonation (issue #44, api/service/auth_mock.go) ──────────
//
// mockStart mints an impersonation JWT for the target user; the CLI stores it
// as the "mock" slot so every subsequent command rides it (makeClient priority
// 0) until `auth mock-exit` or TTL expiry. Wire contract (user/protocol/mock.go):
//   req  {targetUserId, reason, sessionTtl?, source?}   (sessionTtl, lowercase l)
//   resp {token, targetUser, originalUser, sessionId, expiresTime, source?}

/** Display summary out of a backend domain.User object (key → username → id). */
function userSummary(u: any): string | undefined {
  if (!u || typeof u !== "object") return undefined;
  if (typeof u.key === "string" && u.key) return u.key;
  if (typeof u.username === "string" && u.username) return u.username;
  return u.id !== undefined && u.id !== null ? String(u.id) : undefined;
}

export interface MockStartInput {
  targetUserId: string;
  /** Session TTL in seconds; omitted → server default 7200 (auth_mock.go:18). */
  ttl?: number;
  /** Entry-point provenance (e.g. "customer_detail"); recorded, never authorized on. */
  source?: string;
  /** Audit reason (protocol marks it required; CLI defaults to a provenance string). */
  reason?: string;
}

/**
 * POST /api/auth/mockStart with an already-authed client (makeClient — the
 * operator's own identity) and persist the returned session in the "mock"
 * slot of `env`. Takes a client instead of a Profile because impersonation
 * must ride the auto-auth precedence without re-entering it mid-flow.
 */
export async function mockStart(client: HttpClient, env: string, req: MockStartInput): Promise<{ resp: any; session: MockSession }> {
  if (!String(req.targetUserId ?? "").trim()) {
    throw new HotelByteError(400, "target-user-id is required", "/api/auth/mockStart");
  }
  const resp = await client.post("/api/auth/mockStart", {
    targetUserId: req.targetUserId,
    sessionTtl: req.ttl && req.ttl > 0 ? req.ttl : undefined,
    source: req.source,
    reason: req.reason,
  });
  const token = resp && typeof resp === "object" ? (resp as any).token : undefined;
  if (typeof token !== "string" || !token) {
    throw new HotelByteError(500, `Could not extract token from mockStart response: ${JSON.stringify(resp)}`, "/api/auth/mockStart");
  }
  const session: MockSession = {
    ticket: token,
    sessionId: typeof (resp as any).sessionId === "string" ? (resp as any).sessionId : undefined,
    expiresTime: typeof (resp as any).expiresTime === "string" ? (resp as any).expiresTime : undefined,
    targetUser: userSummary((resp as any).targetUser),
    originalUser: userSummary((resp as any).originalUser),
  };
  saveMockSession(env, session);
  return { resp, session };
}