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

// Resolved per-call (not at module load) so tests can redirect the store via
// process.env.STAICLI_HOME at runtime — a module-load constant made test
// fixtures leak into the real ~/.staicli/credentials.json (issue: key123/tok456
// pollution discovered 2026-09-08).
export function staicliHome(): string {
  return process.env.STAICLI_HOME ?? process.env.HOTELBYTE_HOME ?? join(homedir(), ".staicli");
}
function credFile(): string {
  return join(staicliHome(), "credentials.json");
}

// ── profile ─────────────────────────────────────────────────────────────

// "customer" = C 端邮箱验证码登录档（advisor 的客户；新邮箱即注册）。
// 无密码/无 env 凭据回退——一次性验证码换取的 ticket 是唯一凭据。
export type ProfileName = "openapi" | "portal" | "customer";

export interface Profile {
  name: ProfileName;
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
  const file = credFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

function saveStore(data: StoreData): void {
  mkdirSync(staicliHome(), { recursive: true });
  writeFileSync(credFile(), JSON.stringify(data, null, 2));
  try {
    chmodSync(credFile(), 0o600);
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

export function loadProfile(name: ProfileName, env: string = DEFAULT_ENV): Profile {
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
    // Direct bearer injection (gotry/NL-booking passthrough): stored ticket wins;
    // HOTELBYTE_TOKEN injects a pre-obtained portal session / openapi ticket
    // without touching the credential store.
    ticket: saved.ticket ?? process.env.HOTELBYTE_TOKEN,
  };
}

export function clearTicket(name: ProfileName, env: string = DEFAULT_ENV): void {
  const store = loadStore();
  const key = `${name}:${env}`;
  if (store[key]) {
    store[key].ticket = undefined;
    saveStore(store);
  }
}