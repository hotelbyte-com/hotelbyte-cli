/**
 * commands/portal/helpers.ts — shared portal client builder + run wrapper.
 */

import { loadProfile } from "../../core/config.ts";
import { HttpClient, HotelByteError } from "../../core/http.ts";
import { authenticatePortal } from "../../core/auth.ts";
import { emit, error } from "../../utils/output.ts";

export type Ctx = { jsonMode: () => boolean; env: () => string; username: () => string | undefined; password: () => string | undefined };

export async function makePortalClient(ctx: Ctx): Promise<HttpClient> {
  const profile = loadProfile("portal", ctx.env());
  if (ctx.username()) profile.username = ctx.username();
  if (ctx.password()) profile.password = ctx.password();
  await authenticatePortal(profile);
  return new HttpClient(profile);
}

export async function runPortal(ctx: Ctx, path: string, body: any): Promise<void> {
  try {
    const client = await makePortalClient(ctx);
    const resp = await client.post(path, body);
    emit(resp, ctx.jsonMode());
  } catch (e: any) {
    if (e instanceof HotelByteError) {
      error(e.message, ctx.jsonMode());
      process.exit(1);
    }
    throw e;
  }
}