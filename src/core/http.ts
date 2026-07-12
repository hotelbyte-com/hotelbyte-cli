/**
 * http.ts — thin fetch wrapper with auth injection.
 *
 * All HotelByte endpoints are POST JSON. This client:
 *  - injects `Authorization: Bearer <ticket>` when available
 *  - prefixes the configured base URL
 *  - raises HotelByteError on non-2xx with the raw body
 */

import type { Profile } from "./config.ts";
import { getAuthHeader } from "./config.ts";

export class HotelByteError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string,
  ) {
    super(`[${status}] ${path}: ${body.slice(0, 500)}`);
    this.name = "HotelByteError";
  }
}

export class HttpClient {
  constructor(
    public profile: Profile,
    public timeout = 30_000,
  ) {}

  async post<T = any>(path: string, body?: unknown): Promise<T> {
    const url = `${this.profile.baseUrl}${path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const auth = getAuthHeader(this.profile);
    if (auth) headers["Authorization"] = auth;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return (await this._handle<T>(resp, path)) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async get<T = any>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.profile.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    const headers: Record<string, string> = {};
    const auth = getAuthHeader(this.profile);
    if (auth) headers["Authorization"] = auth;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url, { method: "GET", headers, signal: controller.signal });
      return (await this._handle<T>(resp, path)) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async _handle<T>(resp: Response, path: string): Promise<T> {
    if (resp.status >= 400) {
      const text = await resp.text();
      throw new HotelByteError(resp.status, text, path);
    }
    const text = await resp.text();
    if (!text) return undefined as T;
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return text as T;
    }
    // HotelByte API wraps responses in {code, msg, data}.
    // Unwrap .data for consumers. If code != 0, raise an error.
    if (parsed && typeof parsed === "object" && "code" in parsed && "data" in parsed) {
      if (parsed.code !== 0) {
        throw new HotelByteError(parsed.code, parsed.msg ?? text, path);
      }
      return parsed.data as T;
    }
    return parsed as T;
  }
}