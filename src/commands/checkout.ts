/**
 * commands/checkout.ts — checkout intents, guest payment and link ops.
 *
 * checkout intents create    Create a guest payment intent (advisor; write — requires --confirm)
 * checkout intents get       Read intent status by checkout-intent-id (advisor) or token (guest projection)
 * checkout payment start     Start the PSP payment for an intent (guest; write — requires --confirm)
 * checkout links expire      Mark stale pending/paying links expired (ops; write — requires --confirm)
 *
 * Endpoints verified against the live method registry
 * (`/api/view/getApiPaths type=checkout`) and the source contracts in
 * trade/service/checkout_wrapper.go + trade/protocol/checkout_intent.go:
 *   createHotelCheckoutIntent / getHotelCheckoutIntent /
 *   startHotelCheckoutPayment / expireStaleLinks (the only @auth:required
 *   method on the service).
 *
 * The @auth:false anonymous surface (getDetail, getPaymentResultStatus,
 * listAnonymousReceipts, mergeUpdate) is deliberately not wrapped here.
 *
 * Write confirmation follows the `catalogs` guardrail model: known writes
 * refuse to execute without an explicit --confirm.
 */

import { Command } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by intents create / payment start / links expire (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

export function createCheckoutCommand(ctx: Ctx): Command {
  const checkout = new Command("checkout").description("Checkout: guest payment intents, payment start, link ops");

  const intents = new Command("intents").description("Hotel checkout intents (advisor-created guest payment links)");

  intents
    .command("create")
    .description("Create a guest payment intent; returns payUrl + server-priced amount (write operation — requires --confirm)")
    .requiredOption("--data <json>", "CreateHotelCheckoutIntentReq JSON (holder, guests, stay, customerReferenceNo), or @file.json")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "checkout intents create", opts.confirm);
      await run(ctx, "/api/checkout/createHotelCheckoutIntent", parseJsonInput(opts.data));
    });

  intents
    .command("get")
    .description("Read intent status — advisor owner with --checkout-intent-id, guest projection with --token")
    .option("--checkout-intent-id <id>", "Checkout intent ID (advisor owner read)")
    .option("--token <token>", "Guest checkout token (anonymous safe projection)")
    .action(async (opts) => {
      if (!opts.checkoutIntentId && !opts.token) {
        console.error("✗ --checkout-intent-id or --token is required");
        process.exit(1);
      }
      const body: any = {};
      if (opts.checkoutIntentId) body.checkoutIntentId = parseInt(opts.checkoutIntentId, 10);
      if (opts.token) body.token = opts.token;
      await run(ctx, "/api/checkout/getHotelCheckoutIntent", body);
    });

  checkout.addCommand(intents);

  checkout
    .command("payment")
    .description("Guest payment operations")
    .command("start")
    .description("Start the PSP payment for an intent after guest consent (write operation — requires --confirm)")
    .requiredOption("--checkout-intent-id <id>", "Checkout intent ID")
    .requiredOption("--payment-channel <channel>", "Payment channel (see intents get paymentChannels)")
    .requiredOption("--idempotency-key <key>", "Idempotency key for this payment attempt")
    .option("--consent", "Accept the advisor order.read consent declaration", false)
    .option("--policy-version <v>", "Consent policy version (from intents get)")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "checkout payment start", opts.confirm);
      const body: any = {
        checkoutIntentId: parseInt(opts.checkoutIntentId, 10),
        paymentChannel: opts.paymentChannel,
        idempotencyKey: opts.idempotencyKey,
      };
      if (opts.consent || opts.policyVersion) {
        body.advisorOrderReadConsent = { accepted: !!opts.consent };
        if (opts.policyVersion) body.advisorOrderReadConsent.policyVersion = opts.policyVersion;
      }
      await run(ctx, "/api/checkout/startHotelCheckoutPayment", body);
    });

  checkout
    .command("links")
    .description("Checkout link operations")
    .command("expire")
    .description("Mark pending/paying links past their expiry as expired (ops sweep; write operation — requires --confirm)")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "checkout links expire", opts.confirm);
      await run(ctx, "/api/checkout/expireStaleLinks", {});
    });

  return checkout;
}
