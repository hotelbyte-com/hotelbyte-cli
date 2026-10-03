/**
 * commands/ops.ts — platform ops surface: S6 price cache, issue tools, cron admin.
 *
 * Backed by the dispatcher services "ops" (api/service/ops.go, ops_issue.go)
 * and "cronAdmin" (api/service/cron_admin.go). Paths verified against the live
 * getApiPaths catalog (2026-10-04). priceCache/* and cronAdmin/* carry
 * `internal` / `platform` permissions server-side — the CLI sends the ticket
 * and lets RBAC decide.
 *
 * ops price-cache status    PriceCache hit/miss stats
 * ops price-cache configs   Per-credential TTL configuration
 * ops price-cache purge     Purge price-cache keys (write — requires --confirm)
 * ops issues diagnose       Diagnose an error code against live signals
 * ops issues repair         Run a repair action (write — requires --confirm)
 * ops cron list             List registered cron jobs
 * ops cron trigger          Trigger a job run now (write — requires --confirm)
 * ops cron enable           Enable a job (write — requires --confirm)
 * ops cron disable          Disable a job (write — requires --confirm)
 *
 * Write confirmation follows the `catalogs` guardrail model: known writes
 * refuse to execute without an explicit --confirm.
 */

import { Command } from "commander";
import { run, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by purge / repair / cron writes (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

/** Split "k1=v1,k2=v2" into a string map (server-side map[string]string). */
function parseParams(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

/** Build the IssueRefs object (api/protocol/issue_tools.go) from flags. */
function issueRefs(opts: any): any {
  const refs: any = {};
  if (opts.runId) refs.runId = opts.runId;
  if (opts.jobId) refs.jobId = opts.jobId;
  if (opts.sessionId) refs.sessionId = opts.sessionId;
  if (opts.customerEntityId) refs.customerEntityId = opts.customerEntityId;
  if (opts.supplierId) refs.supplierId = opts.supplierId;
  if (opts.credentialIds) {
    refs.specifiedCredentialIds = opts.credentialIds.split(",").map((s: string) => s.trim()).filter(Boolean);
  }
  return refs;
}

/** The shared --*-id ref flags for diagnose / repair. */
function addIssueRefOptions(cmd: Command): Command {
  return cmd
    .option("--run-id <id>", "Reference lookout run ID")
    .option("--job-id <id>", "Reference lookout job ID")
    .option("--session-id <id>", "Reference request session ID")
    .option("--customer-entity-id <id>", "Reference customer entity ID")
    .option("--supplier-id <id>", "Reference supplier ID")
    .option("--credential-ids <ids>", "Comma-separated supplier credential IDs");
}

export function createOpsCommand(ctx: Ctx): Command {
  const ops = new Command("ops").description("Platform ops: price cache, issue tools, cron admin");

  const priceCache = ops.command("price-cache").description("S6 HotelRates price cache (internal permission)");

  priceCache
    .command("status")
    .description("Price cache hit/miss statistics")
    .option("--supplier-id <id>", "Scope to one supplier")
    .action(async (opts) => {
      const body: any = {};
      if (opts.supplierId) body.supplierId = opts.supplierId;
      await run(ctx, "/api/ops/priceCache/status", body);
    });

  priceCache
    .command("configs")
    .description("Per-credential price cache TTL configuration")
    .option("--supplier-id <id>", "Scope to one supplier")
    .action(async (opts) => {
      const body: any = {};
      if (opts.supplierId) body.supplierId = opts.supplierId;
      await run(ctx, "/api/ops/priceCache/configs", body);
    });

  priceCache
    .command("purge")
    .description("Purge price cache keys (write operation — requires --confirm)")
    .requiredOption("--pattern <pattern>", "Key pattern, e.g. search:price:Hotelbeds:*")
    .option("--dry-run", "Preview matched keys without deleting", false)
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "ops price-cache purge", opts.confirm);
      const body: any = { pattern: opts.pattern };
      if (opts.dryRun) body.dryRun = true;
      await run(ctx, "/api/ops/priceCache/purge", body);
    });

  const issues = ops.command("issues").description("Issue diagnosis and repair");

  addIssueRefOptions(
    issues
      .command("diagnose")
      .description("Diagnose an error code against live signals")
      .requiredOption("--error-code <code>", "Business error code to diagnose"),
  ).action(async (opts) => {
    const body: any = { errorCode: opts.errorCode, refs: issueRefs(opts) };
    await run(ctx, "/api/ops/diagnoseIssue", body);
  });

  addIssueRefOptions(
    issues
      .command("repair")
      .description("Run a repair action (write operation — requires --confirm)")
      .requiredOption("--error-code <code>", "Business error code to repair")
      .requiredOption("--action-id <id>", "Repair action ID from ops issues diagnose")
      .option("--trigger-run", "Re-trigger the lookout run after repair", false)
      .option("--confirm", "Confirm execution of write operations", false),
  ).action(async (opts) => {
    requireConfirm(ctx, "ops issues repair", opts.confirm);
    const body: any = { errorCode: opts.errorCode, actionId: opts.actionId, refs: issueRefs(opts) };
    if (opts.triggerRun) body.options = { triggerRun: true };
    await run(ctx, "/api/ops/repairIssue", body);
  });

  const cron = ops.command("cron").description("Cron job administration (platform permission)");

  cron
    .command("list")
    .description("List registered cron jobs")
    .option("--module <name>", "Filter by module")
    .option("--enabled <bool>", "Filter by enabled state (true/false)")
    .option("--keyword <text>", "Keyword search over job names")
    .option("--page <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { page: parseInt(opts.page, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.module) body.module = opts.module;
      if (opts.enabled !== undefined) body.enabled = opts.enabled === "true";
      if (opts.keyword) body.q = opts.keyword;
      await run(ctx, "/api/cronAdmin/listJobs", body);
    });

  cron
    .command("trigger")
    .description("Trigger a job run now (write operation — requires --confirm)")
    .requiredOption("--name <name>", "Job name")
    .option("--test-params <params>", "Test params k1=v1,k2=v2")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "ops cron trigger", opts.confirm);
      const body: any = { name: opts.name };
      if (opts.testParams) body.testParams = parseParams(opts.testParams);
      await run(ctx, "/api/cronAdmin/trigger", body);
    });

  cron
    .command("enable")
    .description("Enable a cron job (write operation — requires --confirm)")
    .requiredOption("--name <name>", "Job name")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "ops cron enable", opts.confirm);
      await run(ctx, "/api/cronAdmin/enable", { name: opts.name });
    });

  cron
    .command("disable")
    .description("Disable a cron job (write operation — requires --confirm)")
    .requiredOption("--name <name>", "Job name")
    .option("--reason <text>", "Reason recorded in the audit log")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "ops cron disable", opts.confirm);
      const body: any = { name: opts.name };
      if (opts.reason) body.reason = opts.reason;
      await run(ctx, "/api/cronAdmin/disable", body);
    });

  return ops;
}
