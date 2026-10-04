/**
 * tests/auth_accounts.test.ts — `hbcli auth accounts` multi-account
 * snapshot/restore (issue #43).
 *
 * Two layers:
 *   - core (src/core/config.ts): store semantics, current-account matching,
 *     restore planning — driven directly with STAICLI_HOME isolation.
 *   - CLI (spawnSync src/cli.ts): end-to-end global-flag contract (--json
 *     before the subcommand), stderr warnings, exit codes — same harness as
 *     cli.test.ts, each test in its own temp home.
 *
 * No test touches a live environment; all tickets below are fake.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENVIRONMENTS,
  accountMatchesCurrent,
  applyAccountRestore,
  getAccount,
  isValidAccountName,
  listAccounts,
  loadProfile,
  planAccountRestore,
  removeAccount,
  saveAccount,
  saveProfile,
  snapshotTicketedSlots,
  type AccountSnapshot,
  type Profile,
} from "../src/core/config.ts";
import { maskSecret } from "../src/utils/output.ts";

// Same gitignored scratch dir the other test files use (bun test runs files
// sequentially in one process, so per-file beforeEach/afterEach never overlap).
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

// ── core: store semantics ───────────────────────────────────────────────

function portalSlot(over: Partial<Profile> = {}): Profile {
  return {
    name: "portal",
    env: "uat",
    baseUrl: ENVIRONMENTS.uat,
    username: "admin@corp.com",
    password: "pw1",
    ticket: "portal-ticket-A",
    ...over,
  };
}

describe("accounts core: snapshot/restore (issue #43)", () => {
  it("save → mutate → use roundtrip restores the original slot verbatim", () => {
    saveProfile(portalSlot());
    const { snapshot, identities } = snapshotTicketedSlots("uat");
    expect(identities).toEqual(["portal"]);
    saveAccount("work", snapshot);

    // Switch: the portal slot now holds a different login session.
    saveProfile(portalSlot({ username: "other@corp.com", password: "pw2", ticket: "portal-ticket-B" }));
    expect(loadProfile("portal", "uat").ticket).toBe("portal-ticket-B");

    const snap = getAccount("work");
    expect(snap).toBeDefined();
    applyAccountRestore(snap!, "uat");

    const restored = loadProfile("portal", "uat");
    expect(restored.username).toBe("admin@corp.com");
    expect(restored.password).toBe("pw1");
    expect(restored.ticket).toBe("portal-ticket-A");
  });

  it("use overwrites the live slot and the restored state matches current again", () => {
    saveProfile(portalSlot());
    saveAccount("work", snapshotTicketedSlots("uat").snapshot);
    saveProfile(portalSlot({ ticket: "portal-ticket-B" }));
    expect(accountMatchesCurrent(getAccount("work")!, "uat")).toBe(false);

    applyAccountRestore(getAccount("work")!, "uat");
    expect(loadProfile("portal", "uat").ticket).toBe("portal-ticket-A");
    expect(accountMatchesCurrent(getAccount("work")!, "uat")).toBe(true);
  });

  it("snapshot-absent identity gets its ticket cleared but keeps login material (no accidental wipe)", () => {
    saveProfile(portalSlot());
    // customer has a username but no ticket at save time → not in the snapshot
    saveProfile({ name: "customer", env: "uat", baseUrl: ENVIRONMENTS.uat, username: "guest@mail.com" });
    saveAccount("solo", snapshotTicketedSlots("uat").snapshot);
    expect(getAccount("solo")!.customer).toBeUndefined();

    // customer later logs in elsewhere; portal switches too.
    saveProfile({ name: "customer", env: "uat", baseUrl: ENVIRONMENTS.uat, username: "guest@mail.com", ticket: "customer-ticket-NEW" });
    saveProfile(portalSlot({ username: "other@corp.com", ticket: "portal-ticket-B" }));

    const plan = planAccountRestore(getAccount("solo")!, "uat");
    expect(plan.restored).toEqual(["portal"]);
    expect(plan.cleared).toEqual(["customer"]);

    applyAccountRestore(getAccount("solo")!, "uat");
    const customer = loadProfile("customer", "uat");
    expect(customer.ticket).toBeUndefined(); // stale session gone
    expect(customer.username).toBe("guest@mail.com"); // login material preserved
    expect(loadProfile("portal", "uat").ticket).toBe("portal-ticket-A");
  });

  it("snapshot only covers ticketed slots; a ticketless slot is left out", () => {
    saveProfile(portalSlot({ ticket: undefined })); // username/password only
    const { identities } = snapshotTicketedSlots("uat");
    expect(identities).toEqual([]);
  });

  it("default slot keys stay untouched and the reserved accounts section rides along", () => {
    saveProfile(portalSlot());
    saveAccount("work", snapshotTicketedSlots("uat").snapshot);
    const raw = JSON.parse(readFileSync(join(TMP_HOME, "credentials.json"), "utf8"));
    expect(raw["portal:uat"].ticket).toBe("portal-ticket-A");
    expect(raw.accounts.work.portal.ticket).toBe("portal-ticket-A");
    expect(raw.accounts.work.savedAt).toBeTruthy();
  });

  it("a legacy store without an accounts section still loads", () => {
    writeFileSync(join(TMP_HOME, "credentials.json"), JSON.stringify({ "openapi:uat": { ticket: "legacy" } }));
    expect(listAccounts()).toEqual({});
    expect(getAccount("work")).toBeUndefined();
    expect(removeAccount("work")).toBe(false);
    expect(loadProfile("openapi", "uat").ticket).toBe("legacy");
  });

  it("remove deletes only the named snapshot and reports misses", () => {
    saveProfile(portalSlot());
    const snap = snapshotTicketedSlots("uat").snapshot;
    saveAccount("a", snap);
    saveAccount("b", { ...snap, savedAt: "2026-01-02T00:00:00.000Z" });

    expect(removeAccount("a")).toBe(true);
    expect(getAccount("a")).toBeUndefined();
    expect(Object.keys(listAccounts())).toEqual(["b"]);
    expect(removeAccount("a")).toBe(false);
  });

  it("saveAccount tolerates a __proto__ name at the core layer (own property, no prototype pollution)", () => {
    const snap: AccountSnapshot = { portal: { username: "a@b.c" }, savedAt: "2026-01-01T00:00:00.000Z" };
    saveAccount("__proto__", snap);
    expect(Object.prototype.hasOwnProperty.call(listAccounts(), "__proto__")).toBe(true);
    expect(getAccount("__proto__")?.portal?.username).toBe("a@b.c");
  });
});

describe("accounts core: name validation", () => {
  it("accepts plain names incl. email-like and dotted ones", () => {
    for (const name of ["work", "Work2", "team.uat", "a@b.c", "a-b_c"]) {
      expect(isValidAccountName(name)).toBe(true);
    }
  });

  it("rejects empty, pathy, spaced, reserved and overlong names", () => {
    for (const name of ["", "../evil", "has space", "__proto__", "-lead", ".dot", "savedAt", "x".repeat(65)]) {
      expect(isValidAccountName(name)).toBe(false);
    }
  });
});

describe("maskSecret (first 4 + last 2, issue #43)", () => {
  it("reveals only the first 4 and last 2 characters", () => {
    expect(maskSecret("hotelbyte_api_demo")).toBe("hote****mo");
  });

  it("fully masks short values (a 4+2 window would reveal everything)", () => {
    expect(maskSecret("abc")).toBe("****");
    expect(maskSecret("abcdef")).toBe("****");
  });

  it("passes undefined through", () => {
    expect(maskSecret(undefined)).toBeUndefined();
  });
});

// ── CLI: flags, stderr, exit codes ──────────────────────────────────────

const CLI_PATH = join(import.meta.dir, "..", "src", "cli.ts");
// process.execPath is the running Bun binary: the suite must not depend on
// "bun" being on PATH (same reason as cli.test.ts).
const BUN_BIN = process.execPath;

function runCli(args: string[], home: string): { stdout: string; stderr: string; exitCode: number | null } {
  const result = spawnSync(BUN_BIN, ["run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    // Global flag contract lives in the src/cli.ts prescan; HOTELBYTE_ENV is
    // pinned so a developer's shell export cannot flip the env under test.
    env: { ...process.env, STAICLI_HOME: home, HOTELBYTE_ENV: "uat" } as Record<string, string>,
  });
  return { stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "", exitCode: result.status };
}

function seedStore(home: string, store: unknown): void {
  writeFileSync(join(home, "credentials.json"), JSON.stringify(store, null, 2));
}

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "hbcli-accounts-test-"));
}

const WORK_STORE = {
  "openapi:uat": { appKey: "hotelbyte_api_demo", appSecret: "super-secret-key", ticket: "openapi-ticket-AAA" },
  "portal:uat": { username: "admin@corp.com", password: "pw1", ticket: "portal-ticket-BBB" },
};

describe("auth accounts CLI (issue #43)", () => {
  it("--help lists the four subcommands", () => {
    const home = tempHome();
    try {
      const { stdout, exitCode } = runCli(["auth", "accounts", "--help"], home);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("save");
      expect(stdout).toContain("list");
      expect(stdout).toContain("use");
      expect(stdout).toContain("remove");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("save → use roundtrip through the real store file (--json before the subcommand)", () => {
    const home = tempHome();
    try {
      seedStore(home, WORK_STORE);
      const saved = JSON.parse(runCli(["--json", "auth", "accounts", "save", "work"], home).stdout);
      expect(saved.status).toBe("saved");
      expect(saved.identities).toEqual(["openapi", "portal"]);

      // Switch the live portal session (accounts section preserved), then restore.
      seedStore(home, {
        ...JSON.parse(readFileSync(join(home, "credentials.json"), "utf8")),
        "portal:uat": { username: "other@corp.com", password: "pw2", ticket: "portal-ticket-YYY" },
      });
      const used = JSON.parse(runCli(["--json", "auth", "accounts", "use", "work"], home).stdout);
      expect(used.status).toBe("restored");

      const store = JSON.parse(readFileSync(join(home, "credentials.json"), "utf8"));
      expect(store["portal:uat"].ticket).toBe("portal-ticket-BBB");
      expect(store["portal:uat"].username).toBe("admin@corp.com");
      expect(store["openapi:uat"].appKey).toBe("hotelbyte_api_demo");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("use warns on stderr which slots it overwrites before restoring", () => {
    const home = tempHome();
    try {
      seedStore(home, WORK_STORE);
      runCli(["--json", "auth", "accounts", "save", "work"], home);
      seedStore(home, {
        ...JSON.parse(readFileSync(join(home, "credentials.json"), "utf8")),
        "portal:uat": { username: "other@corp.com", ticket: "portal-ticket-YYY" },
      });
      const { stderr, exitCode } = runCli(["--json", "auth", "accounts", "use", "work"], home);
      expect(exitCode).toBe(0);
      expect(stderr).toContain("⚠");
      expect(stderr).toContain('accounts use "work"');
      expect(stderr).toContain("overwriting slots: openapi, portal");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("list --json masks key values and marks the snapshot matching the live slots", () => {
    const home = tempHome();
    try {
      seedStore(home, WORK_STORE);
      runCli(["--json", "auth", "accounts", "save", "work"], home);
      const { stdout } = runCli(["--json", "auth", "accounts", "list"], home);
      const out = JSON.parse(stdout);

      expect(out.current).toBe("work");
      expect(out.account_count).toBe(1);
      const row = out.accounts[0];
      expect(row.name).toBe("work");
      expect(row.current).toBe(true);
      expect(row.openapi.app_key).toBe("hote****mo"); // first 4 + last 2
      expect(row.openapi.has_ticket).toBe(true);
      expect(row.portal.username).toBe("admin@corp.com"); // email stays full
      expect(row.portal.has_ticket).toBe(true);
      // The plaintext secret never leaves the store file.
      expect(stdout).not.toContain("super-secret-key");
      expect(stdout).not.toContain("portal-ticket");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("whoami --json names the matching snapshot, or anonymous when none matches", () => {
    const home = tempHome();
    try {
      seedStore(home, { "portal:uat": { username: "x@y.z", ticket: "t-no-snapshot" } });
      expect(JSON.parse(runCli(["--json", "auth", "whoami"], home).stdout).account).toBe("anonymous");

      seedStore(home, WORK_STORE);
      runCli(["--json", "auth", "accounts", "save", "work"], home);
      expect(JSON.parse(runCli(["--json", "auth", "whoami"], home).stdout).account).toBe("work");

      // Rotate the live ticket (snapshot kept) → mismatch, not a missing snapshot.
      seedStore(home, {
        ...JSON.parse(readFileSync(join(home, "credentials.json"), "utf8")),
        "portal:uat": { username: "admin@corp.com", password: "pw1", ticket: "portal-ticket-ROTATED" },
      });
      expect(JSON.parse(runCli(["--json", "auth", "whoami"], home).stdout).account).toBe("anonymous");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("use with an unknown account exits 1 with a JSON error on stderr", () => {
    const home = tempHome();
    try {
      seedStore(home, WORK_STORE);
      const { stderr, exitCode } = runCli(["--json", "auth", "accounts", "use", "ghost"], home);
      expect(exitCode).toBe(1);
      expect(JSON.parse(stderr).error).toContain("ghost");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("save without ticketed slots exits 1", () => {
    const home = tempHome();
    try {
      seedStore(home, { "portal:uat": { username: "x@y.z" } });
      const { stderr, exitCode } = runCli(["--json", "auth", "accounts", "save", "empty"], home);
      expect(exitCode).toBe(1);
      expect(JSON.parse(stderr).error).toContain("No ticketed credentials");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("remove deletes the snapshot; removing it again exits 1", () => {
    const home = tempHome();
    try {
      seedStore(home, WORK_STORE);
      runCli(["--json", "auth", "accounts", "save", "work"], home);

      const removed = JSON.parse(runCli(["--json", "auth", "accounts", "remove", "work"], home).stdout);
      expect(removed.status).toBe("removed");

      // Default slots are untouched by remove.
      const store = JSON.parse(readFileSync(join(home, "credentials.json"), "utf8"));
      expect(store["portal:uat"].ticket).toBe("portal-ticket-BBB");
      expect(store.accounts).toEqual({});

      const again = runCli(["--json", "auth", "accounts", "remove", "work"], home);
      expect(again.exitCode).toBe(1);
      expect(JSON.parse(again.stderr).error).toContain("work");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
