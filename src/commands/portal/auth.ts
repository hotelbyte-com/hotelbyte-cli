/**
 * commands/portal/auth.ts — Portal authentication.
 */

import { Command } from "commander";
import { DEFAULT_ENV, ENVIRONMENTS, loadProfile, saveProfile, clearTicket, type Profile } from "../../core/config.ts";
import { HttpClient, HotelByteError } from "../../core/http.ts";
import { extractTicket } from "../../core/auth.ts";
import { emit, error } from "../../utils/output.ts";

type Ctx = { jsonMode: () => boolean; env: () => string; username: () => string | undefined; password: () => string | undefined };

export function createPortalAuthCommand(ctx: Ctx): Command {
  const auth = new Command("auth").description("Portal authentication (username/password → JWT ticket)");

  // login
  auth
    .command("login")
    .description("Login and cache the JWT ticket")
    .requiredOption("--username <user>", "Portal username/email")
    .requiredOption("--password <pass>", "Portal password")
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
        emit(resp, ctx.jsonMode());
      } catch (e: any) {
        if (e instanceof HotelByteError) { error(e.message, ctx.jsonMode()); process.exit(1); }
        throw e;
      }
    });

  // logout
  auth
    .command("logout")
    .description("Clear the cached ticket")
    .action(() => {
      clearTicket("portal", ctx.env());
      emit({ status: "logged_out", env: ctx.env() }, ctx.jsonMode());
    });

  // whoami
  auth
    .command("whoami")
    .description("Show the current cached credentials/ticket status")
    .action(() => {
      const profile = loadProfile("portal", ctx.env());
      emit({
        env: profile.env,
        username: profile.username,
        has_ticket: !!profile.ticket,
        base_url: profile.baseUrl,
      }, ctx.jsonMode());
    });

  return auth;
}