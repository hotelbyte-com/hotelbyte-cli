/**
 * commands/auth.ts — Authentication commands.
 *
 * Two auth paths, both stored in the same credential store:
 *   set-credentials  → API key mode (appKey/appSecret → ticket), for integrators
 *   login            → Portal mode (username/password → ticket), for admins
 *   whoami / logout  → inspect / clear session
 */

import { Command } from "commander";
import { DEFAULT_ENV, ENVIRONMENTS, loadProfile, saveProfile, clearTicket, type Profile } from "../core/config.ts";
import { HttpClient, HotelByteError } from "../core/http.ts";
import { extractTicket } from "../core/auth.ts";
import { emit, error } from "../utils/output.ts";

type Ctx = { jsonMode: () => boolean; env: () => string };

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
        const client = new HttpClient(profile);
        const resp = await client.post("/api/auth/login", { username: opts.username, password: opts.password });
        profile.ticket = extractTicket(resp);
        saveProfile(profile);
        emit({ status: "logged_in", env: opts.env, mode: "portal" }, ctx.jsonMode());
      } catch (e: any) {
        if (e instanceof HotelByteError) { error(e.message, ctx.jsonMode()); process.exit(1); }
        throw e;
      }
    });

  // logout
  auth
    .command("logout")
    .description("Clear cached session ticket")
    .action(() => {
      clearTicket("openapi", ctx.env());
      clearTicket("portal", ctx.env());
      emit({ status: "logged_out" }, ctx.jsonMode());
    });

  // whoami
  auth
    .command("whoami")
    .description("Show current auth status")
    .action(() => {
      const apiProfile = loadProfile("openapi", ctx.env());
      const portalProfile = loadProfile("portal", ctx.env());
      emit({
        env: ctx.env(),
        api_key: apiProfile.appKey ? { configured: true, has_ticket: !!apiProfile.ticket } : { configured: false },
        portal: portalProfile.username ? { configured: true, username: portalProfile.username, has_ticket: !!portalProfile.ticket } : { configured: false },
        base_url: apiProfile.baseUrl,
      }, ctx.jsonMode());
    });

  return auth;
}
