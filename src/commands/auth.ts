/**
 * commands/auth.ts — Authentication commands.
 *
 * Auth paths, all stored in the same credential store:
 *   set-credentials   → API key mode (appKey/appSecret → ticket), for integrators
 *   login             → Portal mode (username/password → ticket), for admins
 *   send-code/register            → Tenant self-registration (email + OTP code, B 端)
 *   customer-send-code/customer-login → Customer email-code login (C 端, advisor 的客户);
 *                                       a new email is auto-registered
 *   whoami / logout   → inspect / clear session
 */

import { Command } from "commander";
import { DEFAULT_ENV, ENVIRONMENTS, loadProfile, saveProfile, clearTicket, type Profile } from "../core/config.ts";
import { HotelByteError } from "../core/http.ts";
import {
  authenticatePortal,
  sendRegistrationOtp,
  checkDomainAvailability,
  registerTenantAccount,
  sendCustomerLoginCode,
  loginByCustomerEmailCode,
} from "../core/auth.ts";
import { emit, error } from "../utils/output.ts";

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
        api_key: apiProfile.appKey ? { configured: true, has_ticket: !!apiProfile.ticket } : { configured: false },
        portal: portalProfile.username ? { configured: true, username: portalProfile.username, has_ticket: !!portalProfile.ticket } : { configured: false },
        customer: customerProfile.ticket ? { configured: true, email: customerProfile.username, has_ticket: true } : { configured: false },
        base_url: apiProfile.baseUrl,
      }, ctx.jsonMode());
    });

  return auth;
}
