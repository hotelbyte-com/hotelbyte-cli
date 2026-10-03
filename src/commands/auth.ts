/**
 * commands/auth.ts — Authentication commands.
 *
 * Auth paths, all stored in the same credential store:
 *   set-credentials   → API key mode (appKey/appSecret → ticket), for integrators
 *   login             → Portal mode (username/password → ticket), for admins
 *   send-code/register            → Tenant self-registration (email + OTP code, B 端)
 *   customer-send-code/customer-login → Customer email-code login (C 端, advisor 的客户);
 *                                       a new email is auto-registered
 *   accounts save/list/use/remove → named multi-account snapshots of the
 *                                       default slots (issue #43)
 *   whoami / logout   → inspect / clear session
 */

import { Command } from "commander";
import {
  DEFAULT_ENV,
  ENVIRONMENTS,
  loadProfile,
  saveProfile,
  clearTicket,
  accountMatchesCurrent,
  applyAccountRestore,
  getAccount,
  isValidAccountName,
  listAccounts,
  planAccountRestore,
  removeAccount,
  saveAccount,
  snapshotTicketedSlots,
  type AccountIdentity,
  type Profile,
  type SlotCredentials,
} from "../core/config.ts";
import { HotelByteError } from "../core/http.ts";
import {
  authenticatePortal,
  sendRegistrationOtp,
  checkDomainAvailability,
  registerTenantAccount,
  sendCustomerLoginCode,
  loginByCustomerEmailCode,
} from "../core/auth.ts";
import { emit, error, warn, maskSecret } from "../utils/output.ts";

type Ctx = { jsonMode: () => boolean; env: () => string };

// Shared error handling: backend/param errors → stderr + exit 1; anything
// else is a CLI bug and must crash loudly.
function fail(e: any, jsonMode: boolean): never {
  if (e instanceof HotelByteError) {
    error(e.message, jsonMode);
    process.exit(1);
  }
  throw e;
}

// Bare profile for public (pre-auth) endpoints: baseUrl only, no ticket.
function publicProfile(name: Profile["name"], env: string): Profile {
  return { name, env, baseUrl: ENVIRONMENTS[env] ?? ENVIRONMENTS[DEFAULT_ENV] };
}

// ── accounts helpers (issue #43) ────────────────────────────────────────

// Per-identity display row for `accounts list`: username/email in full,
// key ids masked (first 4 + last 2), tickets never rendered (has_ticket only).
function identityRow(id: AccountIdentity, creds?: SlotCredentials): Record<string, unknown> | null {
  if (!creds) return null;
  if (id === "openapi") {
    return { app_key: maskSecret(creds.appKey), has_ticket: !!creds.ticket };
  }
  if (id === "customer") {
    return { email: creds.username, has_ticket: !!creds.ticket };
  }
  return { username: creds.username, has_ticket: !!creds.ticket };
}

// Latest-saved snapshot whose identities all still equal the live default
// slots; null when the current session matches no snapshot (whoami renders
// that as "anonymous").
function currentAccountName(env: string): string | null {
  const matches = Object.entries(listAccounts())
    .filter(([, snap]) => accountMatchesCurrent(snap, env))
    .sort((a, b) => String(b[1].savedAt).localeCompare(String(a[1].savedAt)));
  return matches[0]?.[0] ?? null;
}

export function createAuthCommand(ctx: Ctx): Command {
  const auth = new Command("auth").description("Authentication and credentials");

  // set-credentials (API key mode — for integrators)
  auth
    .command("set-credentials")
    .description("Store API key credentials (appKey/appSecret) for integrators")
    .requiredOption("--app-key <key>", "API application key")
    .requiredOption("--app-secret <secret>", "API application secret")
    .option("--env <env>", "Environment", DEFAULT_ENV)
    .action((opts) => {
      const profile: Profile = {
        name: "openapi",
        env: opts.env,
        baseUrl: ENVIRONMENTS[opts.env] ?? ENVIRONMENTS[DEFAULT_ENV],
        appKey: opts.appKey,
        appSecret: opts.appSecret,
      };
      saveProfile(profile);
      emit({ status: "saved", env: opts.env, mode: "api-key" }, ctx.jsonMode());
    });

  // login (portal mode — for admins)
  auth
    .command("login")
    .description("Login with username/password (portal admin mode)")
    .requiredOption("--username <user>", "Username or email")
    .requiredOption("--password <pass>", "Password")
    .option("--env <env>", "Environment", DEFAULT_ENV)
    .action(async (opts) => {
      const profile: Profile = {
        name: "portal",
        env: opts.env,
        baseUrl: ENVIRONMENTS[opts.env] ?? ENVIRONMENTS[DEFAULT_ENV],
        username: opts.username,
        password: opts.password,
      };
      try {
        // authenticatePortal POSTs the backend contract {email, password}
        // (hotel-be LoginReq) and saves the profile; the action previously
        // posted {username, password} directly and failed server-side.
        await authenticatePortal(profile);
        emit({ status: "logged_in", env: opts.env, mode: "portal" }, ctx.jsonMode());
      } catch (e: any) {
        fail(e, ctx.jsonMode());
      }
    });

  // send-code (tenant registration OTP — B 端, step 1 of register)
  auth
    .command("send-code")
    .description("Send an email OTP code for tenant registration (B 端 register step 1)")
    .requiredOption("--email <email>", "Email address that receives the OTP")
    .option("--env <env>", "Environment", DEFAULT_ENV)
    .action(async (opts) => {
      try {
        const resp = await sendRegistrationOtp(publicProfile("portal", opts.env), opts.email);
        emit({ status: "sent", env: opts.env, email: opts.email, ...resp }, ctx.jsonMode());
      } catch (e: any) {
        fail(e, ctx.jsonMode());
      }
    });

  // check-domain (tenant registration pre-flight)
  auth
    .command("check-domain")
    .description("Check if the email's domain is available for tenant registration")
    .requiredOption("--email <email>", "Email to extract the domain from")
    .option("--domain <domain>", "Check a specific domain instead of the email's")
    .option("--env <env>", "Environment", DEFAULT_ENV)
    .action(async (opts) => {
      try {
        const resp = await checkDomainAvailability(publicProfile("portal", opts.env), opts.email, opts.domain);
        emit({ status: "checked", env: opts.env, email: opts.email, ...resp }, ctx.jsonMode());
      } catch (e: any) {
        fail(e, ctx.jsonMode());
      }
    });

  // register (tenant self-registration — B 端; auto-login on success)
  auth
    .command("register")
    .description("Register a new tenant with email + OTP code + password (auto-login, B 端)")
    .requiredOption("--email <email>", "Email address (receives the OTP via 'auth send-code')")
    .requiredOption("--password <pass>", "Account password (min 8 chars)")
    .requiredOption("--tenant-name <name>", "Display name of the new tenant")
    .requiredOption("--otp-code <code>", "OTP code from the registration email")
    .option("--tenant-domain <domain>", "Custom tenant domain (non-prod only; default: email domain)")
    .option("--module <code>", "Interested module code, repeatable (e.g. portal_search, booking_engine)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option("--env <env>", "Environment", DEFAULT_ENV)
    .action(async (opts) => {
      try {
        const { resp } = await registerTenantAccount(publicProfile("portal", opts.env), {
          email: opts.email,
          password: opts.password,
          tenantName: opts.tenantName,
          tenantDomain: opts.tenantDomain,
          otpCode: opts.otpCode,
          interestedModules: opts.module.length > 0 ? opts.module : undefined,
        });
        // Ticket is persisted in the credential store, not echoed.
        const { token: _omit, ...created } = resp ?? {};
        emit({ status: "registered", env: opts.env, mode: "portal", token_saved: true, ...created }, ctx.jsonMode());
      } catch (e: any) {
        fail(e, ctx.jsonMode());
      }
    });

  // customer-send-code (C 端 customer login code — advisor 的客户)
  auth
    .command("customer-send-code")
    .description("Send an email login code for customer login (C 端, advisor 的客户)")
    .requiredOption("--email <email>", "Customer email address")
    .option("--env <env>", "Environment", DEFAULT_ENV)
    .action(async (opts) => {
      try {
        const resp = await sendCustomerLoginCode(publicProfile("customer", opts.env), opts.email);
        emit({ status: "sent", env: opts.env, email: opts.email, ...resp }, ctx.jsonMode());
      } catch (e: any) {
        fail(e, ctx.jsonMode());
      }
    });

  // customer-login (C 端: OTP verified = logged in; new email = auto-registered)
  auth
    .command("customer-login")
    .description("Customer login with email + code (C 端; a new email is auto-registered)")
    .requiredOption("--email <email>", "Customer email address")
    .requiredOption("--code <code>", "Code from the customer login email")
    .option("--ttl <seconds>", "Token idle timeout in seconds (0 = server default)", (v: string) => Number(v), 0)
    .option("--attribution-token <token>", "Advisor attribution token (binds the customer to the advisor)")
    .option("--env <env>", "Environment", DEFAULT_ENV)
    .action(async (opts) => {
      try {
        const { resp } = await loginByCustomerEmailCode(publicProfile("customer", opts.env), {
          email: opts.email,
          code: opts.code,
          ttl: opts.ttl > 0 ? opts.ttl : undefined,
          attributionToken: opts.attributionToken,
        });
        const { token: _omit, ...session } = resp ?? {};
        emit({ status: "logged_in", env: opts.env, mode: "customer", token_saved: true, ...session }, ctx.jsonMode());
      } catch (e: any) {
        fail(e, ctx.jsonMode());
      }
    });

  // ── accounts (issue #43: local multi-account snapshot/restore) ──────────
  const accounts = new Command("accounts").description(
    "Named snapshots of the current default slots (multi-account switching)",
  );

  // accounts save <name>
  accounts
    .command("save")
    .description("Snapshot the current ticketed default slots (openapi/portal/customer) as a named account")
    .argument("<name>", "Account name")
    .action((name: string) => {
      if (!isValidAccountName(name)) {
        error(`Invalid account name "${name}" (letters/digits/._@-, starting alphanumeric, ≤ 64 chars)`, ctx.jsonMode());
        process.exit(1);
      }
      const env = ctx.env();
      const { snapshot, identities } = snapshotTicketedSlots(env);
      if (identities.length === 0) {
        error(
          "No ticketed credentials to save for this environment. Run 'auth login', 'auth set-credentials' or 'auth customer-login' first.",
          ctx.jsonMode(),
        );
        process.exit(1);
      }
      const existing = getAccount(name);
      if (existing) warn(`account "${name}" already exists (saved ${existing.savedAt}); replacing`);
      saveAccount(name, snapshot);
      emit({ status: "saved", account: name, env, identities, savedAt: snapshot.savedAt }, ctx.jsonMode());
    });

  // accounts list
  accounts
    .command("list")
    .description("List saved accounts with per-identity status (keys masked) and which one matches the current default slots")
    .action(() => {
      const env = ctx.env();
      const rows = Object.entries(listAccounts()).map(([name, snap]) => ({
        name,
        savedAt: snap.savedAt,
        current: accountMatchesCurrent(snap, env),
        openapi: identityRow("openapi", snap.openapi),
        portal: identityRow("portal", snap.portal),
        customer: identityRow("customer", snap.customer),
      }));
      emit({ env, account_count: rows.length, current: currentAccountName(env), accounts: rows }, ctx.jsonMode());
    });

  // accounts use <name>
  accounts
    .command("use")
    .description("Restore a saved account into the current environment's default slots (overwrites the live slots)")
    .argument("<name>", "Account name")
    .action((name: string) => {
      const env = ctx.env();
      const snap = getAccount(name);
      if (!snap) {
        error(`Account "${name}" not found. Run 'auth accounts list' to see saved accounts.`, ctx.jsonMode());
        process.exit(1);
      }
      const plan = planAccountRestore(snap, env);
      if (plan.restored.length > 0 || plan.cleared.length > 0) {
        const detail: string[] = [];
        if (plan.restored.length > 0) detail.push(`overwriting slots: ${plan.restored.join(", ")}`);
        if (plan.cleared.length > 0) detail.push(`clearing tickets: ${plan.cleared.join(", ")}`);
        warn(`accounts use "${name}" (env ${env}) — ${detail.join("; ")}`);
      }
      applyAccountRestore(snap, env);
      emit({ status: "restored", account: name, env, restored: plan.restored, cleared: plan.cleared }, ctx.jsonMode());
    });

  // accounts remove <name>
  accounts
    .command("remove")
    .description("Delete a saved account snapshot (default slots are untouched)")
    .argument("<name>", "Account name")
    .action((name: string) => {
      if (!removeAccount(name)) {
        error(`Account "${name}" not found. Run 'auth accounts list' to see saved accounts.`, ctx.jsonMode());
        process.exit(1);
      }
      emit({ status: "removed", account: name }, ctx.jsonMode());
    });

  auth.addCommand(accounts);

  // logout
  auth
    .command("logout")
    .description("Clear cached session ticket")
    .action(() => {
      clearTicket("openapi", ctx.env());
      clearTicket("portal", ctx.env());
      clearTicket("customer", ctx.env());
      emit({ status: "logged_out" }, ctx.jsonMode());
    });

  // whoami
  auth
    .command("whoami")
    .description("Show current auth status")
    .action(() => {
      const apiProfile = loadProfile("openapi", ctx.env());
      const portalProfile = loadProfile("portal", ctx.env());
      const customerProfile = loadProfile("customer", ctx.env());
      emit({
        env: ctx.env(),
        // Named account when the default slots still match a snapshot (issue #43).
        account: currentAccountName(ctx.env()) ?? "anonymous",
        api_key: apiProfile.appKey ? { configured: true, has_ticket: !!apiProfile.ticket } : { configured: false },
        portal: portalProfile.username ? { configured: true, username: portalProfile.username, has_ticket: !!portalProfile.ticket } : { configured: false },
        customer: customerProfile.ticket ? { configured: true, email: customerProfile.username, has_ticket: true } : { configured: false },
        base_url: apiProfile.baseUrl,
      }, ctx.jsonMode());
    });

  return auth;
}
