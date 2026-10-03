/**
 * commands/notify.ts — notify service: templates, send, in-app inbox.
 *
 * templates list        List notification templates
 * templates get         Get one template by ID
 * templates create      Create a template (write — requires --confirm)
 * templates update      Update a template (write — requires --confirm)
 * send email            Send a raw email via SES (write — requires --confirm)
 * send notification     Send a notification (write — requires --confirm)
 * in-app list           List the current user's in-app notifications
 * in-app unread-count   Get the unread count
 * in-app read           Mark a notification read (write — requires --confirm)
 *
 * All endpoints are notify service methods (live catalog 2026-10-04):
 * listTemplates / getTemplate / createTemplate / updateTemplate, sendEmail /
 * sendNotification, getInAppNotifications / getUnreadCount / markAsRead.
 * Request shapes follow notify/protocol/{requests,notification}.go and the
 * NotifyService bindings (notification_service.go, notification_in_app_service.go):
 * TemplateListRequest uses flat `page`+`pageSize` ints, channel/businessType are
 * numeric codes (1=in_app, 2=email, 3=sms, 4=push, 5=whatsapp), IDs are int64
 * on the templates surface and types.ID (string accepted) on notifications.
 *
 * Write confirmation follows the `catalogs` guardrail model
 * (commands/catalogs.ts): known writes refuse to execute without --confirm.
 */

import { Command } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by every mutating subcommand (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

/** Client-side required-flag rejection before any HTTP call (billing.ts habit). */
function requireFlags(ctx: Ctx, label: string, missing: string[], ok: boolean): void {
  if (ok) return;
  error(`${label}: ${missing.join(" / ")} is required`, ctx.jsonMode());
  process.exit(1);
}

const CHANNEL_HELP = "1=in_app, 2=email, 3=sms, 4=push, 5=whatsapp";

export function createNotifyCommand(ctx: Ctx): Command {
  const notify = new Command("notify").description("Notifications: templates, sending, in-app inbox");

  // ── templates ──────────────────────────────────────────────────────────

  const templates = notify.command("templates").description("Notification template management");

  templates
    .command("list")
    .description("List notification templates")
    .option("--type <type>", "Notification type filter")
    .option("--scenario <scenario>", "Scenario filter")
    .option("--page <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { page: parseInt(opts.page, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.type) body.type = opts.type;
      if (opts.scenario) body.scenario = opts.scenario;
      await run(ctx, "/api/notify/listTemplates", body);
    });

  templates
    .command("get")
    .description("Get one template by ID")
    .requiredOption("--id <n>", "Template ID")
    .action(async (opts) => {
      await run(ctx, "/api/notify/getTemplate", { id: parseInt(opts.id, 10) });
    });

  templates
    .command("create")
    .description("Create a notification template (write operation — requires --confirm)")
    .requiredOption("--name <name>", "Template name")
    .requiredOption("--channel <n>", `Numeric channel code (${CHANNEL_HELP})`)
    .requiredOption("--scenario <scenario>", "Usage scenario")
    .requiredOption("--content <text>", "Template content")
    .option("--description <text>", "Template description")
    .option("--subject <text>", "Subject (email templates)")
    .option("--entity-id <n>", "Entity ID (0/omit = global template, >0 = tenant template)")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "notify templates create", opts.confirm);
      const body: any = {
        channel: parseInt(opts.channel, 10),
        scenario: opts.scenario,
        name: opts.name,
        content: opts.content,
      };
      if (opts.description) body.description = opts.description;
      if (opts.subject) body.subject = opts.subject;
      if (opts.entityId !== undefined) body.entityId = parseInt(opts.entityId, 10);
      await run(ctx, "/api/notify/createTemplate", body);
    });

  templates
    .command("update")
    .description("Update a notification template (write operation — requires --confirm)")
    .requiredOption("--id <n>", "Template ID")
    .option("--name <name>", "New template name")
    .option("--description <text>", "New description")
    .option("--subject <text>", "New subject")
    .option("--content <text>", "New template content")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "notify templates update", opts.confirm);
      const body: any = { id: parseInt(opts.id, 10) };
      if (opts.name) body.name = opts.name;
      if (opts.description) body.description = opts.description;
      if (opts.subject) body.subject = opts.subject;
      if (opts.content) body.content = opts.content;
      await run(ctx, "/api/notify/updateTemplate", body);
    });

  // ── send ───────────────────────────────────────────────────────────────

  const send = notify.command("send").description("Send emails and notifications");

  send
    .command("email")
    .description("Send a raw email via SES (write operation — requires --confirm)")
    .requiredOption("--to <addresses>", "Comma-separated recipient addresses")
    .requiredOption("--subject <text>", "Email subject")
    .requiredOption("--body <text>", "Email body")
    .option("--tenant-brand-entity-id <id>", "Prefer this entity's SES config over the platform default")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "notify send email", opts.confirm);
      const to = opts.to.split(",").map((s: string) => s.trim()).filter(Boolean);
      requireFlags(ctx, "notify send email", ["--to"], to.length > 0);
      const body: any = { to, subject: opts.subject, body: opts.body };
      if (opts.tenantBrandEntityId) body.tenantBrandEntityId = opts.tenantBrandEntityId;
      await run(ctx, "/api/notify/sendEmail", body);
    });

  send
    .command("notification")
    .description("Send a notification (write operation — requires --confirm)")
    .option("--channel <n>", `Numeric channel code (${CHANNEL_HELP})`)
    .option("--business-type <n>", "Numeric business type filter/code")
    .option("--scenario <scenario>", "Notification scenario")
    .option("--recipient <target>", "Recipient (email / phone ...)")
    .option("--subject <text>", "Subject")
    .option("--content <text>", "Content")
    .option("--template-id <id>", "Template ID to render")
    .option("--variables <json>", "Template variables as JSON, or @file.json")
    .option("--tenant-brand-entity-id <id>", "Tenant brand entity ID")
    .option("--sender-user-id <id>", "Sender user ID")
    .option("--receiver-user-id <id>", "Receiver user ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "notify send notification", opts.confirm);
      const body: any = {};
      if (opts.channel) body.channel = parseInt(opts.channel, 10);
      if (opts.businessType) body.businessType = parseInt(opts.businessType, 10);
      if (opts.scenario) body.scenario = opts.scenario;
      if (opts.recipient) body.recipient = opts.recipient;
      if (opts.subject) body.subject = opts.subject;
      if (opts.content) body.content = opts.content;
      if (opts.templateId) body.templateId = opts.templateId;
      if (opts.variables) body.variables = parseJsonInput(opts.variables);
      if (opts.tenantBrandEntityId) body.tenantBrandEntityId = opts.tenantBrandEntityId;
      if (opts.senderUserId) body.senderUserId = opts.senderUserId;
      if (opts.receiverUserId) body.receiverUserId = opts.receiverUserId;
      await run(ctx, "/api/notify/sendNotification", body);
    });

  // ── in-app inbox ───────────────────────────────────────────────────────

  const inApp = notify.command("in-app").description("In-app notification inbox");

  inApp
    .command("list")
    .description("List the current user's in-app notifications")
    .option("--business-type <n>", "Numeric business type filter")
    .option("--unread-only", "Only unread notifications", false)
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.businessType) body.businessType = parseInt(opts.businessType, 10);
      if (opts.unreadOnly) body.isRead = false;
      await run(ctx, "/api/notify/getInAppNotifications", body);
    });

  inApp
    .command("unread-count")
    .description("Get the unread notification count")
    .option("--business-type <n>", "Numeric business type filter")
    .action(async (opts) => {
      const body: any = {};
      if (opts.businessType) body.businessType = parseInt(opts.businessType, 10);
      await run(ctx, "/api/notify/getUnreadCount", body);
    });

  inApp
    .command("read")
    .description("Mark a notification read (write operation — requires --confirm)")
    .requiredOption("--notification-id <id>", "Notification ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "notify in-app read", opts.confirm);
      await run(ctx, "/api/notify/markAsRead", { notificationId: opts.notificationId });
    });

  return notify;
}
