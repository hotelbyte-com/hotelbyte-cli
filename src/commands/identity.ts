/**
 * commands/identity.ts — self-service identity surface (user/tenant service).
 *
 * identity audit-logs list     List tenant audit logs
 * identity roles list          List roles in a scope
 * identity roles upsert        Create/update a role (write — requires --confirm)
 * identity mfa setup           Generate MFA setup payload (write — requires --confirm; --force rotates)
 * identity mfa verify          Verify an MFA code without changing state
 * identity preferences get     Read own market/currency preferences
 * identity preferences update  Update own market/currency preferences (write — requires --confirm)
 *
 * Routes (verified against the live method directory, service user/tenant):
 * listAuditLogs (user/service/audit_log.go), listRole / upsertRole
 * (user/service/role.go), generateMFASetup / verifyMFA (user/service/mfa.go),
 * getMyPreferences / updateMyPreferences (user/service/fora_settings.go).
 *
 * Contract notes:
 *  - ListAuditLogReq embeds *domain.AuditLogQuery without a json tag, so query
 *    fields AND the embedded pagehelper.PageReq are promoted to the body top
 *    level: {actionType, actionTimeWindow:{start,end}, actorUserId, …,
 *    pageNum, pageSize} (user/domain/audit_log.go).
 *  - updateMyPreferences is optimistic-locked: --version comes from
 *    `identity preferences get` (user/protocol/fora_settings.go SelfWriteResp).
 *  - mfa setup with --force rotates an existing TOTP binding (user/service/mfa.go
 *    GenerateMFASetup), hence the write guard; mfa verify is a pure check.
 *
 * Write confirmation follows the `catalogs` guardrail: known writes refuse to
 * execute without an explicit --confirm.
 */

import { Command, Option } from "commander";
import { run, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

const BASE = "/api/user/tenant";

export function createIdentityCommand(ctx: Ctx): Command {
  const identity = new Command("identity").description("Audit logs, roles, MFA and personal preferences");

  // ── audit-logs ────────────────────────────────────────────────────────
  const auditLogs = identity.command("audit-logs").description("Tenant audit trail");

  auditLogs
    .command("list")
    .description("List audit logs (action/actor/entity filters; visibility scoped server-side)")
    .option("--action-type <type>", "Action type filter (e.g. USER_INVITE, ROLE_ASSIGN)")
    .option("--actor-user-id <id>", "Filter by acting user")
    .option("--affected-entity-id <id>", "Filter by affected entity")
    .option("--keyword <text>", "Keyword search")
    .option("--include-details", "Include operation detail payloads", false)
    .option("--include-statistics", "Include aggregate statistics", false)
    .option("--sort-by <field>", "Sort field")
    .addOption(new Option("--sort-order <order>", "Sort direction").choices(["asc", "desc"]))
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.actionType) body.actionType = opts.actionType;
      if (opts.actorUserId) body.actorUserId = opts.actorUserId;
      if (opts.affectedEntityId) body.affectedEntityId = opts.affectedEntityId;
      if (opts.keyword) body.keyword = opts.keyword;
      if (opts.includeDetails) body.includeDetails = true;
      if (opts.includeStatistics) body.includeStatistics = true;
      if (opts.sortBy) body.sortBy = opts.sortBy;
      if (opts.sortOrder) body.sortOrder = opts.sortOrder;
      await run(ctx, `${BASE}/listAuditLogs`, body);
    });

  // ── roles ─────────────────────────────────────────────────────────────
  const roles = identity.command("roles").description("Tenant role management");

  roles
    .command("list")
    .description("List roles in a scope")
    .option("--scope <scope>", "Scope string (e.g. \"1:*\" — defaults to the caller's tenant scope)")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "50")
    .action(async (opts) => {
      const body: any = { page: { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) } };
      if (opts.scope) body.entityIds = opts.scope;
      await run(ctx, `${BASE}/listRole`, body);
    });

  roles
    .command("upsert")
    .description("Create or update a role (write operation — requires --confirm)")
    .requiredOption("--name <name>", "Role name")
    .option("--id <id>", "Existing role ID (update instead of create)")
    .option("--privileges <list>", "Comma-separated privilege codes (e.g. invite_tenant_user,manage_markups)")
    .option("--scope <scope>", "Scope string (e.g. \"1:${tenant_group_entity_id}:*\")")
    .option("--description <text>", "Role description")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "identity roles upsert", opts.confirm);
      const body: any = { name: opts.name };
      if (opts.id) body.id = parseInt(opts.id, 10);
      const privileges = opts.privileges?.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (privileges?.length) body.privileges = privileges;
      if (opts.scope) body.scope = opts.scope;
      if (opts.description) body.description = opts.description;
      await run(ctx, `${BASE}/upsertRole`, body);
    });

  // ── mfa ───────────────────────────────────────────────────────────────
  const mfa = identity.command("mfa").description("Multi-factor authentication (TOTP)");

  mfa
    .command("setup")
    .description("Generate MFA setup payload (secret + QR; write — requires --confirm, --force rotates an existing binding)")
    .option("--provider <name>", "MFA provider (default totp)")
    .option("--force", "Rotate even when TOTP is already bound", false)
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "identity mfa setup", opts.confirm);
      const body: any = {};
      if (opts.provider) body.provider = opts.provider;
      if (opts.force) body.force = true;
      await run(ctx, `${BASE}/generateMFASetup`, body);
    });

  mfa
    .command("verify")
    .description("Verify an MFA code without changing state")
    .requiredOption("--code <code>", "Current TOTP code")
    .option("--provider <name>", "MFA provider (default totp)")
    .action(async (opts) => {
      const body: any = { code: opts.code };
      if (opts.provider) body.provider = opts.provider;
      await run(ctx, `${BASE}/verifyMFA`, body);
    });

  // ── preferences ───────────────────────────────────────────────────────
  const preferences = identity.command("preferences").description("Own market/currency preferences");

  preferences
    .command("get")
    .description("Read own preferences (market, currency, optimistic-lock version)")
    .action(async () => {
      await run(ctx, `${BASE}/getMyPreferences`, {});
    });

  preferences
    .command("update")
    .description("Update own market/currency preferences (write operation — requires --confirm; version from `preferences get`)")
    .option("--market <code>", "Departure market code (empty string clears; omit to keep)")
    .option("--currency <code>", "Preferred ISO-4217 currency (empty string clears; omit to keep)")
    .requiredOption("--version <n>", "Optimistic-lock version from `identity preferences get`")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "identity preferences update", opts.confirm);
      const body: any = { version: parseInt(opts.version, 10) };
      // Pointer semantics (fora_settings.go): carry only what the caller set;
      // empty string is a deliberate clear, omission means "no change".
      if (opts.market !== undefined) body.market = opts.market;
      if (opts.currency !== undefined) body.currency = opts.currency;
      await run(ctx, `${BASE}/updateMyPreferences`, body);
    });

  return identity;
}
