/**
 * config.ts — environment profiles and credential management.
 *
 * Mirrors Claude Code's ~/.local/share/claude/versions/ pattern:
 *   ~/.hotelbyte-cli/
 *   ├── versions/        ← installed binary versions
 *   ├── current          ← symlink to active version
 *   └── credentials.json ← credential store (mode 0600)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── environment base URLs ──────────────────────────────────────────────

export const ENVIRONMENTS: Record<string, string> = {
  dev: "http://localhost:8888",
  uat: "https://api-test.hotelbyte.com",
  prod: "https://api.hotelbyte.com",
};

export const DEFAULT_ENV = process.env.HOTELBYTE_ENV ?? "uat";

// ── credential store ────────────────────────────────────────────────────

export const HOTELBYTE_HOME =
  process.env.HOTELBYTE_HOME ?? join(homedir(), ".hotelbyte-cli");
const CRED_FILE = join(HOTELBYTE_HOME, "credentials.json");

// ── profile ─────────────────────────────────────────────────────────────

export interface Profile {
  name: "openapi" | "portal";
  env: string;
  baseUrl: string;
  appKey?: string;
  appSecret?: string;
  username?: string;
  password?: string;
  ticket?: string;
}

export function getAuthHeader(profile: Profile): string | null {
  return profile.ticket ? `Bearer ${profile.ticket}` : null;
}

// ── store I/O ───────────────────────────────────────────────────────────

interface StoreData {
  [key: string]: {
    appKey?: string;
    appSecret?: string;
    username?: string;
    password?: string;
    ticket?: string;
  };
}

function loadStore(): StoreData {
  if (!existsSync(CRED_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CRED_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveStore(data: StoreData): void {
  mkdirSync(HOTELBYTE_HOME, { recursive: true });
  writeFileSync(CRED_FILE, JSON.stringify(data, null, 2));
  try {
    chmodSync(CRED_FILE, 0o600);
  } catch {
    // non-POSIX FS
  }
}

export function saveProfile(profile: Profile): void {
  const store = loadStore();
  const key = `${profile.name}:${profile.env}`;
  store[key] = {
    appKey: profile.appKey,
    appSecret: profile.appSecret,
    username: profile.username,
    password: profile.password,
    ticket: profile.ticket,
  };
  saveStore(store);
}

export function loadProfile(name: "openapi" | "portal", env: string = DEFAULT_ENV): Profile {
  const store = loadStore();
  const key = `${name}:${env}`;
  const saved = store[key] ?? {};
  const baseUrl = process.env.HOTELBYTE_BASE_URL ?? ENVIRONMENTS[env] ?? ENVIRONMENTS[DEFAULT_ENV];
  return {
    name,
    env,
    baseUrl,
    appKey: saved.appKey ?? process.env.HOTELBYTE_APP_KEY,
    appSecret: saved.appSecret ?? process.env.HOTELBYTE_APP_SECRET,
    username: saved.username ?? process.env.HOTELBYTE_USERNAME,
    password: saved.password ?? process.env.HOTELBYTE_PASSWORD,
    ticket: saved.ticket,
  };
}

export function clearTicket(name: "openapi" | "portal", env: string = DEFAULT_ENV): void {
  const store = loadStore();
  const key = `${name}:${env}`;
  if (store[key]) {
    store[key].ticket = undefined;
    saveStore(store);
  }
}