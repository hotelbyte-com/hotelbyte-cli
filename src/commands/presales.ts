/**
 * commands/presales.ts — public pre-sales agent commands (issue #45).
 *
 *   chat     <message>  → SSE stream of A2UI v0.9 events, printed per event as
 *                          it arrives (raw `data:` lines under --json for
 *                          agents, pretty content otherwise)
 *   feedback             → lead / demo_request / human_handoff capture, plain
 *                          {success, message} JSON envelope
 *
 * Both endpoints are public (no login, no ticket) — deliberately NOT routed
 * through makeClient/withAuthRetry: an authenticated caller must never leak
 * its ticket to the anonymous landing surface, and the endpoints ignore auth.
 * Server-side 429 rate limiting is surfaced verbatim.
 */

import { Command, Option } from "commander";
import { HotelByteError } from "../core/http.ts";
import { sendPresalesFeedback, streamPresalesChat } from "../core/presales.ts";
import { emit, error } from "../utils/output.ts";

type Ctx = { jsonMode: () => boolean; env: () => string };

// Shared error handling (same shape as commands/auth.ts): backend/param errors
// → stderr + exit 1; anything else is a CLI bug and must crash loudly.
function fail(e: any, jsonMode: boolean): never {
  if (e instanceof HotelByteError) {
    error(e.message, jsonMode);
    process.exit(1);
  }
  throw e;
}

export function createPresalesCommand(ctx: Ctx): Command {
  const presales = new Command("presales").description(
    "Public pre-sales AI advisor (landing-page agent; no login required)",
  );

  // chat — stream the advisor's answer in real time
  presales
    .command("chat")
    .description("Send one message to the pre-sales advisor; A2UI events print as they arrive (SSE)")
    .argument("<message>", "Visitor message")
    .option("--locale <locale>", "Content locale (server default: zh)")
    .option("--page-context <page>", "Landing page path the visitor is on (server default: /)")
    .option("--session-id <id>", "Continue an existing chat session (multi-turn context)")
    .option("--visitor-id <id>", "Stable visitor identifier (session continuity + rate-limit key)")
    .action(async (message: string, opts: { locale?: string; pageContext?: string; sessionId?: string; visitorId?: string }) => {
      const jsonMode = ctx.jsonMode();
      try {
        await streamPresalesChat(ctx.env(), {
          message,
          locale: opts.locale,
          pageContext: opts.pageContext,
          sessionId: opts.sessionId,
          visitorId: opts.visitorId,
        }, (data) => {
          // Per-event real-time output: raw `data:` lines under --json (the
          // payloads are already JSON → stdout stays agent-parseable JSONL);
          // pretty content for humans. No trailing summary so neither mode
          // gets polluted.
          if (jsonMode) {
            console.log(data);
          } else {
            try {
              console.log(JSON.stringify(JSON.parse(data), null, 2));
            } catch {
              console.log(data);
            }
          }
        });
      } catch (e: any) {
        fail(e, jsonMode);
      }
    });

  // feedback — lead / demo request / human handoff
  presales
    .command("feedback")
    .description("Submit a lead, demo request, or human-handoff note (public, no login)")
    .requiredOption("--email <email>", "Contact email for the follow-up")
    .addOption(
      new Option("--message-type <type>", "What kind of request this is")
        .choices(["lead", "demo_request", "human_handoff"])
        .makeOptionMandatory(),
    )
    .option("--name <name>", "Visitor name")
    .option("--company <company>", "Visitor company")
    .option("--message <message>", "Free-form message")
    .option("--context <context>", "Extra context (e.g. the page or topic that triggered the request)")
    .option("--locale <locale>", "Content locale (server default: zh)")
    .option("--session-id <id>", "Related chat session")
    .option("--visitor-id <id>", "Related visitor ID")
    .action(async (opts: {
      email: string;
      messageType: "lead" | "demo_request" | "human_handoff";
      name?: string;
      company?: string;
      message?: string;
      context?: string;
      locale?: string;
      sessionId?: string;
      visitorId?: string;
    }) => {
      try {
        const resp = await sendPresalesFeedback(ctx.env(), {
          email: opts.email,
          messageType: opts.messageType,
          name: opts.name,
          company: opts.company,
          message: opts.message,
          context: opts.context,
          locale: opts.locale,
          sessionId: opts.sessionId,
          visitorId: opts.visitorId,
        });
        emit(resp, ctx.jsonMode());
      } catch (e: any) {
        fail(e, ctx.jsonMode());
      }
    });

  return presales;
}
