/**
 * auth.ts — authentication flows for both profiles.
 *
 * OpenAPI:  POST /api/auth/ticket  {appKey, appSecret} → {ticket}
 * Portal:   POST /api/auth/login    {username, password} → {ticket}
 *
 * Both flows cache the returned JWT ticket in the credential store.
 */

import type { Profile } from "./config.ts";
import { saveProfile } from "./config.ts";
import { HttpClient, HotelByteError } from "./http.ts";

export function extractTicket(resp: any): string {
  if (resp && typeof resp === "object") {
    for (const key of ["ticket", "Ticket", "token", "access_token", "accessToken"]) {
      const val = resp[key];
      if (typeof val === "string" && val) return val;
    }
    const data = resp.data;
    if (data && typeof data === "object") {
      for (const key of ["ticket", "token", "access_token"]) {
        const val = data[key];
        if (typeof val === "string" && val) return val;
      }
    }
  }
  throw new HotelByteError(500, `Could not extract ticket from response: ${JSON.stringify(resp)}`, "auth");
}

export async function authenticateOpenapi(profile: Profile): Promise<string> {
  if (profile.ticket) return profile.ticket;
  if (!profile.appKey || !profile.appSecret) {
    throw new HotelByteError(
      401,
      "Missing appKey/appSecret. Set via --app-key/--app-secret, env HOTELBYTE_APP_KEY/HOTELBYTE_APP_SECRET, or 'hotelbyte-cli openapi auth set-credentials'.",
      "/api/auth/ticket",
    );
  }
  const client = new HttpClient(profile);
  const resp = await client.post("/api/auth/ticket", { appKey: profile.appKey, appSecret: profile.appSecret });
  const ticket = extractTicket(resp);
  profile.ticket = ticket;
  saveProfile(profile);
  return ticket;
}

export async function authenticatePortal(profile: Profile): Promise<string> {
  if (profile.ticket) return profile.ticket;
  if (!profile.username || !profile.password) {
    throw new HotelByteError(
      401,
      "Missing username/password. Set via --username/--password, env HOTELBYTE_USERNAME/HOTELBYTE_PASSWORD, or 'hotelbyte-cli portal auth login'.",
      "/api/auth/login",
    );
  }
  const client = new HttpClient(profile);
  const resp = await client.post("/api/auth/login", { username: profile.username, password: profile.password });
  const ticket = extractTicket(resp);
  profile.ticket = ticket;
  saveProfile(profile);
  return ticket;
}