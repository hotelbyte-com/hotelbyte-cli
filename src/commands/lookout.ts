/**
 * commands/lookout.ts — Lookout price-comparison surface (issue #33, L1 curated).
 *
 * lookout jobs list               List comparison jobs (paged, filterable)
 * lookout jobs get                Get one comparison job
 * lookout jobs pause              Pause a job (write — requires --confirm)
 * lookout jobs resume             Resume a job (write — requires --confirm)
 * lookout runs list               List comparison runs (paged, filterable)
 * lookout runs get                Get one comparison run (with its reports)
 * lookout runs rows               List one run's result rows (paged)
 * lookout runs trigger            Trigger a run (write — requires --confirm)
 * lookout runs cancel             Cancel a run (write — requires --confirm)
 * lookout reports list            List generated reports
 * lookout reports get             Get one report (with signed download URL)
 * lookout insights price-trends   Price trend points across recent runs
 * lookout insights coverage-trends Coverage trend points across recent runs
 *
 * All endpoints live on the lookout service (LookoutService.Name() == "lookout",
 * lookout/service/init.go; registered as the canonical /api/lookout prefix in
 * api/routes.go). Verified against the live catalog:
 *   listComparisonJobs / getComparisonJob / pauseComparisonJob / resumeComparisonJob,
 *   listComparisonRuns / getComparisonRun / listComparisonRunResultRows /
 *   triggerComparisonRun / cancelComparisonRun,
 *   listReports / downloadComparisonReport,
 *   getComparisonPriceTrends / getComparisonCoverageTrends.
 * Request shapes follow lookout/protocol: pagination is flat pageNum/pageSize
 * (pagehelper.PageReq), IDs travel as jobId / runId / reportId.
 *
 * Write confirmation follows the catalogs guardrail (commands/catalogs.ts):
 * known writes refuse to execute without an explicit --confirm.
 */

import { Command } from "commander";
import { run, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by pause / resume / trigger / cancel (catalogs habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

export function createLookoutCommand(ctx: Ctx): Command {
  const lookout = new Command("lookout").description("Lookout price-comparison monitoring (jobs, runs, reports, insights)");

  // ── jobs ─────────────────────────────────────────────────────────────

  const jobs = new Command("jobs").description("Comparison jobs: monitored price-comparison setups");

  jobs
    .command("list")
    .description("List comparison jobs (paged, filterable)")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .option("--keyword <text>", "Search jobs by name")
    .option("--statuses <list>", "Comma-separated status filters (active, paused, archived, draft)")
    .option("--subscription-id <id>", "Filter by subscription (plan) ID")
    .option("--customer-entity-id <id>", "Filter by customer entity ID")
    .option("--include-stats", "Include last-run stats in each item", false)
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.keyword) body.keyword = opts.keyword;
      if (opts.statuses) body.statuses = opts.statuses.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (opts.subscriptionId) body.subscriptionId = opts.subscriptionId;
      if (opts.customerEntityId) body.customerEntityId = opts.customerEntityId;
      if (opts.includeStats) body.includeStats = true;
      await run(ctx, "/api/lookout/listComparisonJobs", body);
    });

  jobs
    .command("get")
    .description("Get one comparison job")
    .requiredOption("--job-id <id>", "Job ID")
    .action(async (opts) => {
      await run(ctx, "/api/lookout/getComparisonJob", { jobId: opts.jobId });
    });

  jobs
    .command("pause")
    .description("Pause a job's schedule (write operation — requires --confirm)")
    .requiredOption("--job-id <id>", "Job ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "lookout jobs pause", opts.confirm);
      await run(ctx, "/api/lookout/pauseComparisonJob", { jobId: opts.jobId });
    });

  jobs
    .command("resume")
    .description("Resume a paused job's schedule (write operation — requires --confirm)")
    .requiredOption("--job-id <id>", "Job ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "lookout jobs resume", opts.confirm);
      await run(ctx, "/api/lookout/resumeComparisonJob", { jobId: opts.jobId });
    });

  lookout.addCommand(jobs);

  // ── runs ─────────────────────────────────────────────────────────────

  const runs = new Command("runs").description("Comparison runs: executions of a job");

  runs
    .command("list")
    .description("List comparison runs (paged, filterable)")
    .option("--job-id <id>", "Filter by job ID")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .option("--keyword <text>", "Search runs by job name")
    .option("--statuses <list>", "Comma-separated status filters (pending, running, completed, failed, blocked)")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.jobId) body.jobId = opts.jobId;
      if (opts.keyword) body.keyword = opts.keyword;
      if (opts.statuses) body.statuses = opts.statuses.split(",").map((s: string) => s.trim()).filter(Boolean);
      await run(ctx, "/api/lookout/listComparisonRuns", body);
    });

  runs
    .command("get")
    .description("Get one comparison run (with its reports)")
    .requiredOption("--run-id <id>", "Run ID")
    .action(async (opts) => {
      await run(ctx, "/api/lookout/getComparisonRun", { runId: opts.runId });
    });

  runs
    .command("rows")
    .description("List one run's result rows: per-room supplier price comparisons (paged)")
    .requiredOption("--run-id <id>", "Run ID")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .option("--keyword <text>", "Search rows by hotel name/ID")
    .option("--variance-bands <list>", "Comma-separated variance bands (high, medium, low, na)")
    .option("--cell-statuses <list>", "Comma-separated cell statuses (returned, no_offer, failed, not_mapped, timeout)")
    .option("--rate-type <type>", "Rate type filter (e.g. cheapest, cheapest_refundable)")
    .option("--source-market <market>", "Source market filter")
    .action(async (opts) => {
      const body: any = { runId: opts.runId, pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.keyword) body.keyword = opts.keyword;
      if (opts.varianceBands) body.varianceBands = opts.varianceBands.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (opts.cellStatuses) body.cellStatuses = opts.cellStatuses.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (opts.rateType) body.rateType = opts.rateType;
      if (opts.sourceMarket) body.sourceMarket = opts.sourceMarket;
      await run(ctx, "/api/lookout/listComparisonRunResultRows", body);
    });

  runs
    .command("trigger")
    .description("Trigger a run of a job now (write operation — requires --confirm)")
    .requiredOption("--job-id <id>", "Job ID")
    .option("--base-date <date>", "Base date for the comparison (ISO 8601)")
    .option("--dry-run", "Plan the run without dispatching supplier calls", false)
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "lookout runs trigger", opts.confirm);
      const body: any = { jobId: opts.jobId };
      if (opts.baseDate) body.baseDate = opts.baseDate;
      if (opts.dryRun) body.dryRun = true;
      await run(ctx, "/api/lookout/triggerComparisonRun", body);
    });

  runs
    .command("cancel")
    .description("Cancel a pending/running comparison run (write operation — requires --confirm)")
    .requiredOption("--run-id <id>", "Run ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "lookout runs cancel", opts.confirm);
      await run(ctx, "/api/lookout/cancelComparisonRun", { runId: opts.runId });
    });

  lookout.addCommand(runs);

  // ── reports ──────────────────────────────────────────────────────────

  const reports = new Command("reports").description("Generated comparison reports");

  reports
    .command("list")
    .description("List generated reports (filter by job, run or source market)")
    .option("--job-id <id>", "Filter by job ID")
    .option("--run-id <id>", "Filter by run ID")
    .option("--source-market <market>", "Filter by source market")
    .action(async (opts) => {
      const body: any = {};
      if (opts.jobId) body.jobId = opts.jobId;
      if (opts.runId) body.runId = opts.runId;
      if (opts.sourceMarket) body.sourceMarket = opts.sourceMarket;
      await run(ctx, "/api/lookout/listReports", body);
    });

  reports
    .command("get")
    .description("Get one report (includes a signed download URL when storage is configured)")
    .requiredOption("--report-id <id>", "Report ID")
    .action(async (opts) => {
      await run(ctx, "/api/lookout/downloadComparisonReport", { reportId: opts.reportId });
    });

  lookout.addCommand(reports);

  // ── insights ─────────────────────────────────────────────────────────

  const insights = new Command("insights").description("Cross-run trend insights for a job");

  insights
    .command("price-trends")
    .description("Price trend points across a job's recent completed runs")
    .requiredOption("--job-id <id>", "Job ID")
    .option("--limit <n>", "Max recent runs to include", "20")
    .action(async (opts) => {
      const body: any = { jobId: opts.jobId, limit: parseInt(opts.limit, 10) };
      await run(ctx, "/api/lookout/getComparisonPriceTrends", body);
    });

  insights
    .command("coverage-trends")
    .description("Supplier coverage trend points across a job's recent completed runs")
    .requiredOption("--job-id <id>", "Job ID")
    .option("--limit <n>", "Max recent runs to include", "20")
    .action(async (opts) => {
      const body: any = { jobId: opts.jobId, limit: parseInt(opts.limit, 10) };
      await run(ctx, "/api/lookout/getComparisonCoverageTrends", body);
    });

  lookout.addCommand(insights);

  return lookout;
}
