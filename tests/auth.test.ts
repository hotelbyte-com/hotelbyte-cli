/**
 * tests/auth.test.ts — unit tests for authentication flows.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ENVIRONMENTS, saveProfile, loadProfile, type Profile } from "../src/core/config.ts";
import { extractTicket, authenticateOpenapi, authenticatePortal } from "../src/core/auth.ts";
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