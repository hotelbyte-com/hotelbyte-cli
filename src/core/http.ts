/**
 * http.ts — thin fetch wrapper with auth injection.
 *
 * Most HotelByte endpoints are POST JSON. This client:
 *  - injects `Authorization: Bearer <ticket>` when available
 *  - prefixes the configured base URL
 *  - raises HotelByteError on non-2xx with the raw body
 *
 * Non-JSON channels (issue #41, architecture D6): the server streams file
 * responses through httpdispatcher.StreamingOutput (raw bytes + Content-Type +
 * `Content-Disposition: attachment; filename="…"`, no {code,msg,data} envelope)
 * and accepts multipart/form-data on endpoints whose request type implements
 * MultipartRequestDecoder (single file part + ≤64-byte scalar parts; the
 * response is still the standard JSON envelope). `postStream` (issue #45)
 * consumes SSE `data:` line streams (A2UI events from the public presales
 * agent) line by line.
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

/** Result of a raw-byte POST (streaming endpoints). */
export interface RawResponse {
  bytes: Uint8Array;
  contentType: string;
  /** filename= from `Content-Disposition: attachment`, when present. */
  fileName: string | null;
}

/** File part of a multipart POST. */
export interface MultipartFile {
  /** Form field name — the server contracts name it "file". */
  field: string;
  filename: string;
  bytes: Uint8Array;
  contentType?: string;
}

/**
 * {code,msg,data} envelope semantics shared by the JSON and raw channels:
 * non-envelope JSON and unparseable bodies pass through; code != 0 raises.
 * (Mirrors the dispatcher: bizerr errors reach the client as non-2xx + this
 * same envelope, which `_handle`'s status check turns into HotelByteError.)
 */
export function parseEnvelopeBody(text: string, path: string): unknown {
  if (!text) return undefined;
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (parsed && typeof parsed === "object" && "code" in parsed && "data" in parsed) {
    if (parsed.code !== 0) {
      throw new HotelByteError(parsed.code, parsed.msg ?? text, path);
    }
    return parsed.data;
  }
  return parsed;
}

/** filename="x" out of a Content-Disposition attachment header, if any. */
function attachmentFileName(disposition: string | null): string | null {
  if (!disposition) return null;
  return /filename="([^"]*)"/.exec(disposition)?.[1] ?? null;
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

  /**
   * POST expecting a raw (non-JSON) response — streaming endpoints
   * (httpdispatcher.StreamingOutput: trade/lookout order documents and
   * lookout report downloads). No envelope unwrap: bytes, content type and
   * the attachment filename are handed back for the caller to persist.
   * Errors keep the standard contract: non-2xx → HotelByteError.
   */
  async postRaw(path: string, body?: unknown): Promise<RawResponse> {
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
      if (resp.status >= 400) {
        throw new HotelByteError(resp.status, await resp.text(), path);
      }
      return {
        bytes: new Uint8Array(await resp.arrayBuffer()),
        contentType: resp.headers.get("content-type") ?? "",
        fileName: attachmentFileName(resp.headers.get("content-disposition")),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * POST multipart/form-data for endpoints whose request type implements
   * MultipartRequestDecoder (e.g. whitelabel/uploadBrandAsset,
   * content/uploadHotelImage): exactly one file part plus ≤64-byte scalar
   * fields; the response is the usual JSON envelope, so `_handle` applies.
   * Content-Type + boundary are set by fetch from the FormData body.
   */
  async postMultipart<T = any>(path: string, file: MultipartFile, fields?: Record<string, string>): Promise<T> {
    const url = `${this.profile.baseUrl}${path}`;
    const headers: Record<string, string> = {};
    const auth = getAuthHeader(this.profile);
    if (auth) headers["Authorization"] = auth;

    const form = new FormData();
    const blob = new Blob([file.bytes as BlobPart], file.contentType ? { type: file.contentType } : undefined);
    form.append(file.field, blob, file.filename);
    for (const [k, v] of Object.entries(fields ?? {})) form.append(k, String(v));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url, { method: "POST", headers, body: form, signal: controller.signal });
      return (await this._handle<T>(resp, path)) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * POST expecting an SSE stream of `data: <payload>` lines (issue #45: the
   * public presales agent streams A2UI v0.9 events). Each data payload is
   * handed to `onData` verbatim as it arrives — parsing stays with the caller
   * because events are heterogeneous. `event:`/`id:`/`retry:`/comment lines
   * and empty data separators are skipped. Non-2xx keeps the standard
   * contract: HotelByteError carrying the raw body (e.g. the rate limiter's
   * `{"error":"too many requests..."}` on 429). The timeout bounds time-to-
   * first-byte only — an LLM stream may legitimately run longer.
   */
  async postStream(path: string, body: unknown, onData: (data: string) => void): Promise<void> {
    const url = `${this.profile.baseUrl}${path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const auth = getAuthHeader(this.profile);
    if (auth) headers["Authorization"] = auth;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers,
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (resp.status >= 400) {
      throw new HotelByteError(resp.status, await resp.text(), path);
    }
    if (!resp.body) {
      throw new HotelByteError(500, "empty stream body", path);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    // SSE line terminators are \n, \r\n or \r (in event order); splitting on
    // all three keeps chunk boundaries (\r | \n split across reads) correct.
    const processLine = (raw: string) => {
      if (!raw.startsWith("data:")) return;
      const payload = raw.slice(5).replace(/^ /, ""); // spec: strip one optional space
      if (payload) onData(payload);
    };

    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? ""; // keep the trailing partial line
      for (const line of lines) processLine(line);
    }
    buffer += decoder.decode(); // flush the decoder's tail
    if (buffer) processLine(buffer);
  }

  private async _handle<T>(resp: Response, path: string): Promise<T> {
    if (resp.status >= 400) {
      const text = await resp.text();
      throw new HotelByteError(resp.status, text, path);
    }
    return parseEnvelopeBody(await resp.text(), path) as T;
  }
}