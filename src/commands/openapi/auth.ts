/**
 * commands/openapi/auth.ts — OpenAPI authentication.
 */

import { Command } from "commander";
import { ENVIRONMENTS, DEFAULT_ENV, loadProfile, saveProfile, Profile } from "../../core/config.ts";
import { HttpClient, HotelByteError } from "../../core/http.ts";
import { authenticateOpenapi, extractTicket } from "../../core/auth.ts";
import { emit, error } from "../../utils/output.ts";

export function createOpenapiAuthCommand(jsonMode: () => boolean, env: () => string, appKey: () => string | undefined, appSecret: () => string | undefined): Command {
  const auth = new Command("auth").description("OpenAPI authentication (appKey/appSecret → JWT ticket)");

  auth
    .command("set-credentials")
    .description("Persist OpenAPI credentials for the given environment")
    .requiredOption("--app-key <key>", "OpenAPI application key")
    .requiredOption("--app-secret <secret>", "OpenAPI application secret")
    .option("--env <env>", "Environment", DEFAULT_ENV)
    .action((opts) => {
      const profile = new ProfileImpl("openapi", opts.env, ENVIRONMENTS[opts.env] ?? ENVIRONMENTS[DEFAULT_ENV], opts.appKey, opts.appSecret);
      saveProfile(profile);
      emit({ status: "saved", env: opts.env }, jsonMode());
    });

  auth
    .command("ticket")
    .description("Exchange appKey/appSecret for a JWT ticket")
    .option("--ttl <seconds>", "Ticket idle timeout in seconds (0 = server default)", "0")
    .action(async (opts) => {
      const profile = loadProfile("openapi", env());
      if (appKey()) profile.appKey = appKey();
      if (appSecret()) profile.appSecret = appSecret();
      try {
        const client = new HttpClient(profile);
        const body: any = { appKey: profile.appKey, appSecret: profile.appSecret };
        if (opts.ttl && opts.ttl !== "0") body.ttl = parseInt(opts.ttl, 10);
        const resp = await client.post("/api/auth/ticket", body);
        profile.ticket = extractTicket(resp);
        saveProfile(profile);
        emit(resp, jsonMode());
      } catch (e: any) {
        if (e instanceof HotelByteError) {
          error(e.message, jsonMode());
          process.exit(1);
        }
        throw e;
      }
    });

  return auth;
}

// Simple Profile helper since Profile is an interface
class ProfileImpl implements Profile {
  constructor(
    public name: "openapi" | "portal",
    public env: string,
    public baseUrl: string,
    public appKey?: string,
    public appSecret?: string,
    public username?: string,
    public password?: string,
    public ticket?: string,
  ) {}
}