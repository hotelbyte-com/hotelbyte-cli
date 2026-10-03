/**
 * config.ts — environment profiles and credential management.
 *
 * Mirrors Claude Code's ~/.local/share/claude/versions/ pattern:
 *   ~/.hotelbyte-cli/
 *   ├── versions/        ← installed binary versions
 *   ├── current          ← symlink to active version
 *   └── credentials.json ← credential store (mode 0600)
 *
 * Store layout: default slot keys are "profile:env" (e.g. "portal:uat"); one
 * reserved top-level key "accounts" holds named multi-account snapshots
 * (issue #43). Slot keys always contain ":", so "accounts" can never collide.
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
export type ProfileName = "openapi" | "portal" | "customer" | "demo";

// Zero-signup shared sandbox identity (hotel-be#32386): public demo
// credentials on the pre-provisioned demo tenant chain. Deliberately
// decoupled from any tenant brand name — the demo chain may be renamed
// without touching this constant.
export const DEMO_CREDENTIALS: Record<string, { appKey: string; appSecret: string }> = {
  uat: { appKey: "hotelbyte_api_demo", appSecret: "hotelbyte_api_demo" },
};

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

/** One default slot's credentials (store key "profile:env", e.g. "portal:uat"). */
export interface SlotCredentials {
  appKey?: string;
  appSecret?: string;
  username?: string;
  password?: string;
  ticket?: string;
}

/**
 * Named account snapshot (issue #43): per-identity copies of the ticketed
 * default slots plus a save timestamp. Only slots that held a ticket at save
 * time are present; absent identities were logged out (or never logged in).
 */
export interface AccountSnapshot {
  openapi?: SlotCredentials;
  portal?: SlotCredentials;
  customer?: SlotCredentials;
  savedAt: string;
}

/** The reserved "accounts" store section: account name → snapshot. */
export type AccountsSection = Record<string, AccountSnapshot>;

interface StoreData {
  accounts?: AccountsSection;
  [key: string]: SlotCredentials | AccountsSection | undefined;
}

// Slot keys are always "profile:env" (contain ":"), so a slot-keyed read can
// only ever hold SlotCredentials; the key guard keeps the widened store type
// honest without shape-guessing, and tolerates junk instead of crashing.
function slotFrom(store: StoreData, key: string): SlotCredentials {
  const v = store[key];
  return v && typeof v === "object" && key.includes(":") ? (v as SlotCredentials) : {};
}

function loadStore(): StoreData {
  const file = credFile();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
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

function putSlot(name: ProfileName, env: string, creds: SlotCredentials): void {
  const store = loadStore();
  store[`${name}:${env}`] = { ...creds };
  saveStore(store);
}

export function saveProfile(profile: Profile): void {
  putSlot(profile.name, profile.env, {
    appKey: profile.appKey,
    appSecret: profile.appSecret,
    username: profile.username,
    password: profile.password,
    ticket: profile.ticket,
  });
}

export function loadProfile(name: ProfileName, env: string = DEFAULT_ENV): Profile {
  const store = loadStore();
  const saved = slotFrom(store, `${name}:${env}`);
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
  const slot = slotFrom(store, `${name}:${env}`);
  if (Object.keys(slot).length > 0) {
    slot.ticket = undefined;
    saveStore(store);
  }
}

// ── named accounts (issue #43) ──────────────────────────────────────────
//
// Snapshot/restore of the three ticket-bearing default slots under a
// user-chosen name. Default slot keys are never renamed — switching accounts
// copies snapshot ⇄ slot, so older CLIs/installers keep reading the same
// store layout. Restore semantics: identities present in the snapshot have
// their slot replaced wholesale (login material + ticket); identities absent
// from it only get their ticket cleared (equivalent to logout), so `use`
// never destroys re-auth material it did not snapshot.

export const ACCOUNT_IDENTITIES = ["openapi", "portal", "customer"] as const;
export type AccountIdentity = (typeof ACCOUNT_IDENTITIES)[number];

// Display-safe, prototype-safe names: leading alphanumeric, no whitespace,
// no path separators; "savedAt" is rejected so a snapshot can never be
// shadowed by a same-named sibling key in the accounts section.
const ACCOUNT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9.@_-]{0,63}$/;
const RESERVED_ACCOUNT_NAMES = new Set(["savedAt"]);

export function isValidAccountName(name: string): boolean {
  return ACCOUNT_NAME_RE.test(name) && !RESERVED_ACCOUNT_NAMES.has(name);
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function listAccounts(): AccountsSection {
  return loadStore().accounts ?? {};
}

export function getAccount(name: string): AccountSnapshot | undefined {
  const accounts = loadStore().accounts;
  return accounts && hasOwn(accounts, name) ? accounts[name] : undefined;
}

export function saveAccount(name: string, snapshot: AccountSnapshot): void {
  const store = loadStore();
  // Spread with a computed key: defines an own property even for a name like
  // "__proto__" (plain assignment would hit the prototype setter instead).
  store.accounts = { ...(store.accounts ?? {}), [name]: snapshot };
  saveStore(store);
}

export function removeAccount(name: string): boolean {
  const store = loadStore();
  const accounts = store.accounts;
  if (!accounts || !hasOwn(accounts, name)) return false;
  delete accounts[name];
  saveStore(store);
  return true;
}

/** Copy of the ticket-bearing default slots — the save side of `accounts save`. */
export function snapshotTicketedSlots(env: string): { snapshot: AccountSnapshot; identities: AccountIdentity[] } {
  const store = loadStore();
  const snapshot: AccountSnapshot = { savedAt: new Date().toISOString() };
  const identities: AccountIdentity[] = [];
  for (const id of ACCOUNT_IDENTITIES) {
    const slot = slotFrom(store, `${id}:${env}`);
    if (slot.ticket) {
      snapshot[id] = { ...slot };
      identities.push(id);
    }
  }
  return { snapshot, identities };
}

const SLOT_FIELDS = ["appKey", "appSecret", "username", "password", "ticket"] as const;

function credentialsEqual(a?: SlotCredentials, b?: SlotCredentials): boolean {
  return SLOT_FIELDS.every((f) => (a?.[f] ?? undefined) === (b?.[f] ?? undefined));
}

/** True when every identity in the snapshot still equals the live default slot. */
export function accountMatchesCurrent(snapshot: AccountSnapshot, env: string): boolean {
  const store = loadStore();
  return ACCOUNT_IDENTITIES.every((id) => {
    const saved = snapshot[id];
    return !saved || credentialsEqual(saved, slotFrom(store, `${id}:${env}`));
  });
}

export interface RestorePlan {
  /** Identities whose default slot is replaced by the snapshot copy. */
  restored: AccountIdentity[];
  /** Snapshot-absent identities whose stale ticket is cleared (logout). */
  cleared: AccountIdentity[];
}

export function planAccountRestore(snapshot: AccountSnapshot, env: string): RestorePlan {
  const store = loadStore();
  const plan: RestorePlan = { restored: [], cleared: [] };
  for (const id of ACCOUNT_IDENTITIES) {
    if (snapshot[id]) plan.restored.push(id);
    else if (slotFrom(store, `${id}:${env}`).ticket) plan.cleared.push(id);
  }
  return plan;
}

/** Restore a snapshot into the default slots of `env`; returns the applied plan. */
export function applyAccountRestore(snapshot: AccountSnapshot, env: string): RestorePlan {
  const plan = planAccountRestore(snapshot, env);
  for (const id of plan.restored) putSlot(id, env, snapshot[id]!);
  for (const id of plan.cleared) clearTicket(id, env);
  return plan;
}