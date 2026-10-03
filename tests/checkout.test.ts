/**
 * tests/checkout.test.ts — `hbcli checkout` command group.
 *
 * In-process commander tests: the factory is registered into a fresh program
 * and actions run against a global.fetch stub (tests/auth.test.ts pattern)
 * with an isolated STAICLI_HOME seeded by a cached ticket. Asserts request
 * paths and bodies against the checkout service contracts
 * (trade/protocol/checkout_intent.go), the --confirm write guard (positive +
 * negative), the intents-get dual-identity read, and the command tree.
 * No live environment; no secrets in fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createCheckoutCommand } from "../src/commands/checkout.ts";
import { ENVIRONMENTS } from "../src/core/config.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-test-home-checkout");

const captured: { url: string; body: Record<string, unknown> }[] = [];
let originalFetch: typeof fetch;

function stubFetch(data: unknown = { ok: true }): void {
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ code: 0, msg: "ok", data }), { status: 200 });
  }) as typeof fetch;
}

class ExitSignal extends Error {
  constructor(public code: number | undefined) {
    super(`exit ${code}`);
  }
}
let originalExit: typeof process.exit;
async function captureExit(fn: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    if (e instanceof ExitSignal) return e.code;
    throw e;
  }
}

beforeEach(() => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  mkdirSync(TMP_HOME, { recursive: true });
  process.env.STAICLI_HOME = TMP_HOME;
  writeFileSync(join(TMP_HOME, "credentials.json"), JSON.stringify({ "openapi:uat": { ticket: "stub-ticket" } }));
  originalFetch = global.fetch;
  originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new ExitSignal(code);
  }) as typeof process.exit;
  stubFetch();
  captured.length = 0;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.exit = originalExit;
  delete process.env.STAICLI_HOME;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
});

function program(): Command {
  const p = new Command();
  p.addCommand(createCheckoutCommand({ jsonMode: () => true, env: () => "uat" }));
  return p;
}

const BASE = ENVIRONMENTS.uat;

describe("checkout command tree", () => {
  it("registers intents (create/get), payment start and links expire", () => {
    const checkout = program().commands.find((c) => c.name() === "checkout");
    expect(checkout).toBeDefined();
    const intents = checkout?.commands.find((c) => c.name() === "intents");
    expect(intents?.commands.map((c) => c.name())).toEqual(["create", "get"]);
    const payment = checkout?.commands.find((c) => c.name() === "payment");
    expect(payment?.commands.map((c) => c.name())).toEqual(["start"]);
    const links = checkout?.commands.find((c) => c.name() === "links");
    expect(links?.commands.map((c) => c.name())).toEqual(["expire"]);
  });

  it("documents --confirm on the write subcommands", () => {
    const checkout = program().commands.find((c) => c.name() === "checkout");
    expect(checkout?.commands.find((c) => c.name() === "intents")?.commands.find((c) => c.name() === "create")?.options.some((o) => o.long === "--confirm")).toBe(true);
    expect(checkout?.commands.find((c) => c.name() === "payment")?.commands.find((c) => c.name() === "start")?.options.some((o) => o.long === "--confirm")).toBe(true);
    expect(checkout?.commands.find((c) => c.name() === "links")?.commands.find((c) => c.name() === "expire")?.options.some((o) => o.long === "--confirm")).toBe(true);
  });
});

describe("checkout intents (CLI request shapes)", () => {
  const intentReq = {
    clientId: 12,
    hotelId: 34,
    ratePkgId: "pkg-1",
    sessionId: "sess-1",
    checkIn: 20261004,
    checkOut: 20261006,
    holder: { firstName: "Ada", lastName: "Li", email: "ada@guest.com" },
    guests: [{ roomIndex: 1, firstName: "Ada", lastName: "Li" }],
    customerReferenceNo: "CRN-1",
  };

  it("create is a write: refused without --confirm, passthrough payload with it", async () => {
    const code = await captureExit(() =>
      program().parseAsync(["checkout", "intents", "create", "--data", JSON.stringify(intentReq)], { from: "user" }),
    );
    expect(code).toBe(1);
    expect(captured).toHaveLength(0);

    stubFetch({ checkoutIntentId: 9, payUrl: "https://pay/x", status: "awaiting_customer" });
    await program().parseAsync(["checkout", "intents", "create", "--data", JSON.stringify(intentReq), "--confirm"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/checkout/createHotelCheckoutIntent`);
    expect(captured[0]?.body).toEqual(intentReq);
  });

  it("get requires --checkout-intent-id or --token (client-side rejection, no HTTP)", async () => {
    const code = await captureExit(() => program().parseAsync(["checkout", "intents", "get"], { from: "user" }));
    expect(code).toBe(1);
    expect(captured).toHaveLength(0);
  });

  it("get sends the advisor {checkoutIntentId} read as a number", async () => {
    stubFetch({ status: "awaiting_customer", amount: { amount: "100.00", currency: "USD" } });
    await program().parseAsync(["checkout", "intents", "get", "--checkout-intent-id", "9"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/checkout/getHotelCheckoutIntent`);
    expect(captured[0]?.body).toEqual({ checkoutIntentId: 9 });
  });

  it("get sends the guest {token} projection", async () => {
    stubFetch({ status: "payment_pending", payUrl: "https://pay/x" });
    await program().parseAsync(["checkout", "intents", "get", "--token", "tok_abc"], { from: "user" });
    expect(captured[0]?.body).toEqual({ token: "tok_abc" });
  });
});

describe("checkout write guard (--confirm)", () => {
  it("payment start / links expire refuse without --confirm and never reach the server", async () => {
    for (const args of [
      ["checkout", "payment", "start", "--checkout-intent-id", "9", "--payment-channel", "stripe", "--idempotency-key", "k1"],
      ["checkout", "links", "expire"],
    ]) {
      const code = await captureExit(() => program().parseAsync(args, { from: "user" }));
      expect(code).toBe(1);
    }
    expect(captured).toHaveLength(0);
  });

  it("payment start carries the StartHotelCheckoutPaymentReq contract with --confirm", async () => {
    stubFetch({ paymentId: "p1", status: "payment_pending" });
    await program().parseAsync(
      [
        "checkout", "payment", "start",
        "--checkout-intent-id", "9",
        "--payment-channel", "stripe",
        "--idempotency-key", "k1",
        "--consent",
        "--policy-version", "v1",
        "--confirm",
      ],
      { from: "user" },
    );
    expect(captured[0]?.url).toBe(`${BASE}/api/checkout/startHotelCheckoutPayment`);
    expect(captured[0]?.body).toEqual({
      checkoutIntentId: 9,
      paymentChannel: "stripe",
      idempotencyKey: "k1",
      advisorOrderReadConsent: { accepted: true, policyVersion: "v1" },
    });
  });

  it("payment start omits advisorOrderReadConsent when no consent flags are set", async () => {
    stubFetch({ paymentId: "p1" });
    await program().parseAsync(
      ["checkout", "payment", "start", "--checkout-intent-id", "9", "--payment-channel", "stripe", "--idempotency-key", "k1", "--confirm"],
      { from: "user" },
    );
    expect(captured[0]?.body).toEqual({ checkoutIntentId: 9, paymentChannel: "stripe", idempotencyKey: "k1" });
  });

  it("links expire posts an empty body to /api/checkout/expireStaleLinks with --confirm", async () => {
    stubFetch({ expired: 3 });
    await program().parseAsync(["checkout", "links", "expire", "--confirm"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/checkout/expireStaleLinks`);
    expect(captured[0]?.body).toEqual({});
  });
});
