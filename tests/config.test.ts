/**
 * tests/config.test.ts — unit tests for config/credential store.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  ENVIRONMENTS,
  DEFAULT_ENV,
  loadProfile,
  saveProfile,
  clearTicket,
  getAuthHeader,
  type Profile,
} from "../src/core/config.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-test-home");

beforeEach(() => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  mkdirSync(TMP_HOME, { recursive: true });
  process.env.HOTELBYTE_HOME = TMP_HOME;
});

afterEach(() => {
  delete process.env.HOTELBYTE_HOME;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
});

describe("ENVIRONMENTS", () => {
  it("should have dev, uat, prod keys", () => {
    expect(Object.keys(ENVIRONMENTS).sort()).toEqual(["dev", "prod", "uat"]);
  });

  it("should have correct UAT and prod URLs", () => {
    expect(ENVIRONMENTS.uat).toBe("https://api-test.hotelbyte.com");
    expect(ENVIRONMENTS.prod).toBe("https://api.hotelbyte.com");
  });
});

describe("Profile", () => {
  it("authHeader should be null without ticket", () => {
    const p: Profile = { name: "openapi", env: "uat", baseUrl: ENVIRONMENTS.uat };
    expect(getAuthHeader(p)).toBeNull();
  });

  it("authHeader should return Bearer with ticket", () => {
    const p: Profile = { name: "openapi", env: "uat", baseUrl: ENVIRONMENTS.uat, ticket: "abc123" };
    expect(getAuthHeader(p)).toBe("Bearer abc123");
  });
});

describe("Credential Store", () => {
  it("should save and load a profile", () => {
    const p: Profile = {
      name: "openapi", env: "uat", baseUrl: ENVIRONMENTS.uat,
      appKey: "key123", appSecret: "secret123", ticket: "tok456",
    };
    saveProfile(p);
    const loaded = loadProfile("openapi", "uat");
    expect(loaded.appKey).toBe("key123");
    expect(loaded.appSecret).toBe("secret123");
    expect(loaded.ticket).toBe("tok456");
  });

  it("should return empty profile when not found", () => {
    const loaded = loadProfile("openapi", "prod");
    expect(loaded.appKey).toBeUndefined();
    expect(loaded.ticket).toBeUndefined();
  });

  it("should clear ticket but preserve other fields", () => {
    const p: Profile = {
      name: "portal", env: "uat", baseUrl: ENVIRONMENTS.uat,
      username: "admin", password: "pass", ticket: "tok",
    };
    saveProfile(p);
    clearTicket("portal", "uat");
    const loaded = loadProfile("portal", "uat");
    expect(loaded.ticket).toBeUndefined();
    expect(loaded.username).toBe("admin");
  });

  it("should fall back to env vars when store is empty", () => {
    // Use a different env to ensure store is empty for this key
    process.env.HOTELBYTE_APP_KEY = "envkey";
    process.env.HOTELBYTE_APP_SECRET = "envsecret";
    const loaded = loadProfile("openapi", "prod");
    expect(loaded.appKey).toBe("envkey");
    expect(loaded.appSecret).toBe("envsecret");
    delete process.env.HOTELBYTE_APP_KEY;
    delete process.env.HOTELBYTE_APP_SECRET;
  });
});