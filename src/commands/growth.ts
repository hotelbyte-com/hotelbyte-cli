/**
 * commands/growth.ts — growth service: prospects, campaigns, content studio,
 * brand kits, dashboard (tenant-scoped surface).
 *
 * prospects list              List prospects with filters
 * prospects get               Get one prospect by ID
 * prospects create            Create a prospect (write — requires --confirm)
 * prospects activities        List a prospect's activity timeline
 * campaigns list              List campaigns
 * campaigns get               Get one campaign by ID
 * campaigns create            Create a campaign (write — requires --confirm)
 * campaigns launch            Launch a campaign (write — requires --confirm)
 * campaigns pause             Pause a campaign (write — requires --confirm)
 * campaigns executions        List a campaign's send/engagement records
 * content list                List content-studio items
 * content generate            Run an AI process on a studio item (write — requires --confirm)
 * brand-kits list             List brand kits
 * brand-kits get              Get one brand kit by ID
 * brand-kits create           Create a brand kit (write — requires --confirm)
 * dashboard                   Growth dashboard metrics
 *
 * All endpoints are growth/tenant service methods (live catalog 2026-10-04):
 * listProspects / getProspect / createProspect / listProspectActivities,
 * listCampaigns / getCampaign / createCampaign / launchCampaign / pauseCampaign /
 * listCampaignExecutions, listUserContent / aIProcessUserContent,
 * listBrandKits / getBrandKit / createBrandKit, getDashboard.
 * Request shapes follow growth/protocol/{prospect,campaign,brand_kit,
 * user_content,content_social}.go and the handler bindings in
 * growth/service/handler*.go.
 *
 * Write confirmation follows the `catalogs` guardrail model
 * (commands/catalogs.ts): known writes refuse to execute without --confirm.
 */

import { Command, Option } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by every mutating subcommand (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

/** "1, 2" → ["1","2"] with blanks dropped (catalogs.ts habit). */
function csv(value: string | undefined): string[] | undefined {
  const items = value?.split(",").map((s) => s.trim()).filter(Boolean);
  return items?.length ? items : undefined;
}

export function createGrowthCommand(ctx: Ctx): Command {
  const growth = new Command("growth").description("Growth: prospects, campaigns, content studio, brand kits");

  // ── prospects ──────────────────────────────────────────────────────────

  const prospects = growth.command("prospects").description("Sales prospect pipeline");

  prospects
    .command("list")
    .description("List prospects")
    .option("--status <status>", "Pipeline status filter")
    .option("--source <source>", "Source platform filter")
    .option("--region <region>", "Region filter")
    .option("--industry <industry>", "Company industry filter")
    .option("--product-fit <fit>", "Product fit filter")
    .option("--min-lead-score <n>", "Minimum lead score", parseInt)
    .option("--assigned-sdr-id <id>", "Assigned SDR ID")
    .option("--search <query>", "Search company / contact name / email")
    .option("--tags <tags>", "Comma-separated tag filters")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.status) body.status = opts.status;
      if (opts.source) body.source = opts.source;
      if (opts.region) body.region = opts.region;
      if (opts.industry) body.industry = opts.industry;
      if (opts.productFit) body.productFit = opts.productFit;
      if (opts.minLeadScore !== undefined) body.minLeadScore = opts.minLeadScore;
      if (opts.assignedSdrId) body.assignedSdrId = opts.assignedSdrId;
      if (opts.search) body.searchQuery = opts.search;
      const tags = csv(opts.tags);
      if (tags) body.tags = tags;
      await run(ctx, "/api/growth/tenant/listProspects", body);
    });

  prospects
    .command("get")
    .description("Get one prospect by ID")
    .requiredOption("--prospect-id <id>", "Prospect ID")
    .action(async (opts) => {
      await run(ctx, "/api/growth/tenant/getProspect", { prospectId: opts.prospectId });
    });

  prospects
    .command("create")
    .description("Create a prospect (write operation — requires --confirm)")
    .requiredOption("--data <json>", "CreateProspect JSON, or @file.json")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "growth prospects create", opts.confirm);
      await run(ctx, "/api/growth/tenant/createProspect", parseJsonInput(opts.data));
    });

  prospects
    .command("activities")
    .description("List a prospect's activity timeline")
    .requiredOption("--prospect-id <id>", "Prospect ID")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = {
        prospectId: opts.prospectId,
        pageNum: parseInt(opts.pageNum, 10),
        pageSize: parseInt(opts.pageSize, 10),
      };
      await run(ctx, "/api/growth/tenant/listProspectActivities", body);
    });

  // ── campaigns ──────────────────────────────────────────────────────────

  const campaigns = growth.command("campaigns").description("Outbound campaign lifecycle");

  campaigns
    .command("list")
    .description("List campaigns")
    .option("--status <status>", "Campaign status filter")
    .option("--campaign-type <type>", "Campaign type filter")
    .option("--product-target <fit>", "Product target filter")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.status) body.status = opts.status;
      if (opts.campaignType) body.campaignType = opts.campaignType;
      if (opts.productTarget) body.productTarget = opts.productTarget;
      await run(ctx, "/api/growth/tenant/listCampaigns", body);
    });

  campaigns
    .command("get")
    .description("Get one campaign by ID")
    .requiredOption("--campaign-id <id>", "Campaign ID")
    .action(async (opts) => {
      await run(ctx, "/api/growth/tenant/getCampaign", { campaignId: opts.campaignId });
    });

  campaigns
    .command("create")
    .description("Create a campaign (write operation — requires --confirm)")
    .requiredOption("--data <json>", "CreateCampaign JSON, or @file.json")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "growth campaigns create", opts.confirm);
      await run(ctx, "/api/growth/tenant/createCampaign", parseJsonInput(opts.data));
    });

  campaigns
    .command("launch")
    .description("Launch a campaign (write operation — requires --confirm)")
    .requiredOption("--campaign-id <id>", "Campaign ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "growth campaigns launch", opts.confirm);
      await run(ctx, "/api/growth/tenant/launchCampaign", { campaignId: opts.campaignId });
    });

  campaigns
    .command("pause")
    .description("Pause a campaign (write operation — requires --confirm)")
    .requiredOption("--campaign-id <id>", "Campaign ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "growth campaigns pause", opts.confirm);
      await run(ctx, "/api/growth/tenant/pauseCampaign", { campaignId: opts.campaignId });
    });

  campaigns
    .command("executions")
    .description("List a campaign's send/engagement records")
    .requiredOption("--campaign-id <id>", "Campaign ID")
    .option("--prospect-id <id>", "Prospect filter")
    .option("--status <status>", "Execution status filter")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = {
        campaignId: opts.campaignId,
        pageNum: parseInt(opts.pageNum, 10),
        pageSize: parseInt(opts.pageSize, 10),
      };
      if (opts.prospectId) body.prospectId = opts.prospectId;
      if (opts.status) body.status = opts.status;
      await run(ctx, "/api/growth/tenant/listCampaignExecutions", body);
    });

  // ── content studio ─────────────────────────────────────────────────────

  const content = growth.command("content").description("Content studio items and AI generation");

  content
    .command("list")
    .description("List content-studio items")
    .option("--creator-id <id>", "Creator filter")
    .option("--type <type>", "Content type filter")
    .option("--status <status>", "Content status filter")
    .option("--tags <tags>", "Comma-separated tag filters")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.creatorId) body.creatorId = opts.creatorId;
      if (opts.type) body.type = opts.type;
      if (opts.status) body.status = opts.status;
      const tags = csv(opts.tags);
      if (tags) body.tags = tags;
      await run(ctx, "/api/growth/tenant/listUserContent", body);
    });

  content
    .command("generate")
    .description("Run an AI process on a studio item (write operation — requires --confirm)")
    .requiredOption("--content-id <id>", "Content ID")
    .addOption(
      new Option("--process-type <type>", "AI process type")
        .choices(["polishing", "translate", "generate", "summarize", "expand", "shorten"])
        .default("generate"),
    )
    .option("--extra-prompt <text>", "Extra instruction for the AI run")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "growth content generate", opts.confirm);
      const body: any = { contentId: opts.contentId, processType: opts.processType };
      if (opts.extraPrompt) body.extraPrompt = opts.extraPrompt;
      await run(ctx, "/api/growth/tenant/aIProcessUserContent", body);
    });

  // ── brand kits ─────────────────────────────────────────────────────────

  const brandKits = growth.command("brand-kits").description("Brand voice kits for content generation");

  brandKits
    .command("list")
    .description("List brand kits")
    .option("--owner-level <level>", "Owner level filter (platform|tenant_group|tenant_brand)")
    .option("--owner-entity-id <id>", "Owner entity ID (omit for current)")
    .option("--is-active", "Only active kits", false)
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.ownerLevel) body.ownerLevel = opts.ownerLevel;
      if (opts.ownerEntityId) body.ownerEntityId = opts.ownerEntityId;
      if (opts.isActive) body.isActive = true;
      await run(ctx, "/api/growth/tenant/listBrandKits", body);
    });

  brandKits
    .command("get")
    .description("Get one brand kit by ID")
    .requiredOption("--brand-kit-id <id>", "Brand kit ID")
    .action(async (opts) => {
      await run(ctx, "/api/growth/tenant/getBrandKit", { id: opts.brandKitId });
    });

  brandKits
    .command("create")
    .description("Create a brand kit (write operation — requires --confirm)")
    .requiredOption("--name <name>", "Brand kit name")
    .option("--owner-level <level>", "Owner level (platform|tenant_group|tenant_brand)")
    .option("--owner-entity-id <id>", "Owner entity ID (omit for current)")
    .option("--voice-preset <preset>", "Voice preset (evidence_led|bold|friendly|technical)")
    .option("--tone <tone>", "Free-form tone note")
    .option("--keywords <keywords>", "Comma-separated brand keywords")
    .option("--forbidden-claims <claims>", "Comma-separated forbidden claims")
    .option("--default-ctas <ctas>", "Comma-separated default CTAs")
    .option("--asset-refs <refs>", "Comma-separated asset references")
    .option("--default-pillar <pillar>", "Default content pillar")
    .option("--is-active", "Activate the kit on creation", false)
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "growth brand-kits create", opts.confirm);
      const body: any = { name: opts.name, isActive: !!opts.isActive };
      if (opts.ownerLevel) body.ownerLevel = opts.ownerLevel;
      if (opts.ownerEntityId) body.ownerEntityId = opts.ownerEntityId;
      if (opts.voicePreset) body.voicePreset = opts.voicePreset;
      if (opts.tone) body.tone = opts.tone;
      const keywords = csv(opts.keywords);
      if (keywords) body.keywords = keywords;
      const forbiddenClaims = csv(opts.forbiddenClaims);
      if (forbiddenClaims) body.forbiddenClaims = forbiddenClaims;
      const defaultCtas = csv(opts.defaultCtas);
      if (defaultCtas) body.defaultCtas = defaultCtas;
      const assetRefs = csv(opts.assetRefs);
      if (assetRefs) body.assetRefs = assetRefs;
      if (opts.defaultPillar) body.defaultPillar = opts.defaultPillar;
      await run(ctx, "/api/growth/tenant/createBrandKit", body);
    });

  // ── dashboard ──────────────────────────────────────────────────────────

  growth
    .command("dashboard")
    .description("Growth dashboard metrics")
    .option("--start-date <rfc3339>", "Window start (RFC3339)")
    .option("--end-date <rfc3339>", "Window end (RFC3339)")
    .action(async (opts) => {
      const body: any = {};
      if (opts.startDate) body.startDate = opts.startDate;
      if (opts.endDate) body.endDate = opts.endDate;
      await run(ctx, "/api/growth/tenant/getDashboard", body);
    });

  return growth;
}
