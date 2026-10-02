/**
 * tests/auth.test.ts — unit tests for authentication flows.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ENVIRONMENTS, loadProfile, type Profile } from "../src/core/config.ts";
import {
  extractTicket,
  authenticateOpenapi,
  authenticatePortal,
  sendRegistrationOtp,
  checkDomainAvailability,
  registerTenantAccount,
  sendCustomerLoginCode,
  loginByCustomerEmailCode,
} from "../src/core/auth.ts";
import { HotelByteError } from "../src/core/http.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-test-home");

beforeEach(() => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  mkdirSync(TMP_HOME, { recursive: true });
    process.env.STAICLI_HOME = TMP_HOME;
});

afterEach(() => {
    delete process.env.STAICLI_HOME;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
});

// Capture-able fetch stub: returns the queued Response and records the call.
function mockFetchOnce(responseBody: unknown, status = 200) {
  const originalFetch = global.fetch;
  const captured: { url: string; body: Record<string, unknown> }[] = [];
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(responseBody), { status });
  }) as typeof fetch;
  return {
    captured,
    restore: () => { global.fetch = originalFetch; },
  };
}

function bareProfile(name: Profile["name"]): Profile {
  return { name, env: "uat", baseUrl: ENVIRONMENTS.uat };
}

describe("extractTicket", () => {
  it("should extract flat ticket", () => {
    expect(extractTicket({ ticket: "abc" })).toBe("abc");
  });

  it("should extract nested data.ticket", () => {
    expect(extractTicket({ data: { ticket: "xyz" } })).toBe("xyz");
  });

  it("should extract access_token", () => {
    expect(extractTicket({ access_token: "tok" })).toBe("tok");
  });

  it("should throw when no ticket found", () => {
    expect(() => extractTicket({ unrelated: "field" })).toThrow(HotelByteError);
  });
});

describe("authenticateOpenapi", () => {
  it("should reuse cached ticket", async () => {
    const p: Profile = { name: "openapi", env: "uat", baseUrl: ENVIRONMENTS.uat, ticket: "cached" };
    const result = await authenticateOpenapi(p);
    expect(result).toBe("cached");
  });

  it("should throw when missing credentials", async () => {
    const p: Profile = { name: "openapi", env: "uat", baseUrl: ENVIRONMENTS.uat };
    expect(() => authenticateOpenapi(p)).toThrow(HotelByteError);
  });
});

describe("authenticatePortal", () => {
  it("should reuse cached ticket", async () => {
    const p: Profile = { name: "portal", env: "uat", baseUrl: ENVIRONMENTS.uat, ticket: "cached-portal" };
    const result = await authenticatePortal(p);
    expect(result).toBe("cached-portal");
  });

  it("should throw when missing credentials", async () => {
    const p: Profile = { name: "portal", env: "uat", baseUrl: ENVIRONMENTS.uat };
    expect(() => authenticatePortal(p)).toThrow(HotelByteError);
  });

  it("should POST {email, password} to /api/auth/login (backend LoginReq contract)", async () => {
    const originalFetch = global.fetch;
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    global.fetch = (async (_url: unknown, init?: RequestInit) => {
      captured = {
        url: String(_url),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      };
      return new Response(JSON.stringify({ token: "fresh-portal-ticket" }), { status: 200 });
    }) as typeof fetch;
    try {
      const p: Profile = {
        name: "portal", env: "uat", baseUrl: ENVIRONMENTS.uat,
        username: "user@example.com", password: "pw",
      };
      const t = await authenticatePortal(p);
      expect(t).toBe("fresh-portal-ticket");
      expect(captured?.url).toBe(`${ENVIRONMENTS.uat}/api/auth/login`);
      expect(captured?.body.email).toBe("user@example.com");
      expect(captured?.body.password).toBe("pw");
      expect(captured?.body.username).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("registration & email-code flows (issue #14)", () => {
  it("sendRegistrationOtp posts {email} to /api/auth/sendOTP and passes through nextTime/expiresIn", async () => {
    const m = mockFetchOnce({ nextTime: "2026-10-01T12:00:00Z", expiresIn: 300 });
    try {
      const resp = await sendRegistrationOtp(bareProfile("portal"), "founder@corp.com");
      expect(resp.nextTime).toBe("2026-10-01T12:00:00Z");
      expect(resp.expiresIn).toBe(300);
      expect(m.captured[0]?.url).toBe(`${ENVIRONMENTS.uat}/api/auth/sendOTP`);
      expect(m.captured[0]?.body).toEqual({ email: "founder@corp.com" });
    } finally {
      m.restore();
    }
  });

  it("checkDomainAvailability posts {email} plus optional domain to /api/registration/checkDomainAvailability", async () => {
    const m = mockFetchOnce({ available: true, domain: "corp.com" });
    try {
      const resp = await checkDomainAvailability(bareProfile("portal"), "founder@corp.com", "corp.com");
      expect(resp.available).toBe(true);
      expect(m.captured[0]?.url).toBe(`${ENVIRONMENTS.uat}/api/registration/checkDomainAvailability`);
      expect(m.captured[0]?.body).toEqual({ email: "founder@corp.com", domain: "corp.com" });
    } finally {
      m.restore();
    }
  });

  it("registerTenantAccount posts the RegisterTenantReq contract and stores the auto-login JWT as portal profile", async () => {
    const m = mockFetchOnce({
      token: "tenant-jwt",
      tenantGroup: { id: 1, name: "Corp Travel" },
      subscription: { plan: "trial" },
    });
    try {
      const { resp, token } = await registerTenantAccount(bareProfile("portal"), {
        email: "founder@corp.com",
        password: "supersecret1",
        tenantName: "Corp Travel",
        otpCode: "123456",
        interestedModules: ["portal_search"],
      });
      expect(token).toBe("tenant-jwt");
      expect(resp.tenantGroup).toEqual({ id: 1, name: "Corp Travel" });
      expect(m.captured[0]?.url).toBe(`${ENVIRONMENTS.uat}/api/registration/registerTenant`);
      expect(m.captured[0]?.body).toEqual({
        email: "founder@corp.com",
        password: "supersecret1",
        tenantName: "Corp Travel",
        otpCode: "123456",
        interestedModules: ["portal_search"],
      });
      // Auto-login persisted: portal profile usable for the next command.
      const saved = loadProfile("portal", "uat");
      expect(saved.username).toBe("founder@corp.com");
      expect(saved.password).toBe("supersecret1");
      expect(saved.ticket).toBe("tenant-jwt");
    } finally {
      m.restore();
    }
  });

  it("registerTenantAccount omits optional fields instead of sending empty values", async () => {
    const m = mockFetchOnce({ token: "t" });
    try {
      await registerTenantAccount(bareProfile("portal"), {
        email: "founder@corp.com",
        password: "supersecret1",
        tenantName: "Corp",
        otpCode: "123456",
      });
      expect(m.captured[0]?.body).toEqual({
        email: "founder@corp.com",
        password: "supersecret1",
        tenantName: "Corp",
        otpCode: "123456",
      });
    } finally {
      m.restore();
    }
  });

  it("registerTenantAccount fails fast on short password before consuming the one-time OTP", async () => {
    const m = mockFetchOnce({ token: "t" });
    try {
      expect(() =>
        registerTenantAccount(bareProfile("portal"), {
          email: "founder@corp.com",
          password: "short",
          tenantName: "Corp",
          otpCode: "123456",
        }),
      ).toThrow(HotelByteError);
      expect(m.captured.length).toBe(0); // no HTTP call burned the OTP
    } finally {
      m.restore();
    }
  });

  it("sendCustomerLoginCode posts {email} to /api/auth/sendCustomerLoginCode", async () => {
    const m = mockFetchOnce({ nextTime: "2026-10-01T12:05:00Z", expiresIn: 300 });
    try {
      const resp = await sendCustomerLoginCode(bareProfile("customer"), "guest@mail.com");
      expect(resp.expiresIn).toBe(300);
      expect(m.captured[0]?.url).toBe(`${ENVIRONMENTS.uat}/api/auth/sendCustomerLoginCode`);
      expect(m.captured[0]?.body).toEqual({ email: "guest@mail.com" });
    } finally {
      m.restore();
    }
  });

  it("loginByCustomerEmailCode posts {email, code, attributionToken} and stores the ticket under the customer profile", async () => {
    const m = mockFetchOnce({ token: "customer-jwt", user: { email: "guest@mail.com" }, attributionBound: true });
    try {
      const { resp, token } = await loginByCustomerEmailCode(bareProfile("customer"), {
        email: "guest@mail.com",
        code: "654321",
        ttl: 7200,
        attributionToken: "v2.u.sig",
      });
      expect(token).toBe("customer-jwt");
      expect(resp.attributionBound).toBe(true);
      expect(m.captured[0]?.url).toBe(`${ENVIRONMENTS.uat}/api/auth/loginByCustomerEmailCode`);
      expect(m.captured[0]?.body).toEqual({
        email: "guest@mail.com",
        code: "654321",
        ttl: 7200,
        attributionToken: "v2.u.sig",
      });
      const saved = loadProfile("customer", "uat");
      expect(saved.username).toBe("guest@mail.com");
      expect(saved.ticket).toBe("customer-jwt");
      expect(saved.password).toBeUndefined(); // one-shot code is not re-auth material
    } finally {
      m.restore();
    }
  });

  it("loginByCustomerEmailCode rejects an empty code client-side", async () => {
    const m = mockFetchOnce({ token: "t" });
    try {
      expect(() =>
        loginByCustomerEmailCode(bareProfile("customer"), { email: "guest@mail.com", code: "  " }),
      ).toThrow(HotelByteError);
      expect(m.captured.length).toBe(0);
    } finally {
      m.restore();
    }
  });
});