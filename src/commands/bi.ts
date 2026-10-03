/**
 * commands/bi.ts — BI log/session troubleshooting + order analytics.
 *
 * Backed by the dispatcher services "bi/log" and "bi/order" (bi/service/):
 * method-name routing without @path overrides, so the wire paths are
 * /api/bi/log/<method> and /api/bi/order/<method> (verified against the live
 * getApiPaths catalog, 2026-10-04).
 *
 * bi logs query            Query structured API logs (queryLogs)
 * bi sessions list         List request sessions (getSessionList)
 * bi sessions get          Get one session with its logs (getSession)
 * bi sessions related      Related failure sessions (getRelatedSessions)
 * bi incidents clusters    Active incident clusters (getIncidentClusters)
 * bi order-analytics       Order analytics overview/trend (getOrderAnalytics)
 *
 * Read-only group — every method here is a query; no --confirm guards.
 */

import { Command, Option } from "commander";
import { run, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Split a comma-separated flag value into trimmed, non-empty parts. */
function csv(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Map the shared LogQuery flag set (bi/domain/log_query.go) onto a request
 * body. Only set flags are sent — the Go struct marks every field omitempty.
 * Entity IDs (userId/hotelId/…) ride types.ID: JSON strings, 2^53-safe.
 * Cost-time flags are milliseconds on the CLI and nanoseconds on the wire
 * (Go time.Duration marshals as integer ns).
 */
function applyLogQueryFilters(body: any, opts: any): void {
  const set = (key: string, value: string | undefined, transform?: (s: string) => unknown): void => {
    if (value === undefined || value === "") return;
    body[key] = transform ? transform(value) : value;
  };
  set("startTime", opts.startTime);
  set("endTime", opts.endTime);
  set("ids", opts.ids, (v) => csv(v).map(Number));
  set("searchLogId", opts.searchLogId);
  set("searchSessionId", opts.searchSessionId);
  set("searchOrderRef", opts.searchOrderRef);
  set("userId", opts.userId);
  set("sellerEntityId", opts.sellerEntityId);
  set("buyerEntityId", opts.buyerEntityId);
  set("hotelId", opts.hotelId);
  set("orderId", opts.orderId);
  set("supplierBizId", opts.supplierBizId);
  set("supplierBizType", opts.supplierBizType, Number);
  set("apiInPath", opts.apiInPath);
  set("apiOutSupplier", opts.apiOutSupplier);
  set("apiOutPath", opts.apiOutPath);
  set("bizErrorCode", opts.bizErrorCode);
  set("inputHeaderKey", opts.inputHeaderKey);
  set("inputHeaderValue", opts.inputHeaderValue);
  set("inputBodyKeyword", opts.inputBodyKeyword);
  set("outputBodyKeyword", opts.outputBodyKeyword);
  set("outputHttpStatusCode", opts.outputHttpStatusCode, Number);
  set("resultStatus", opts.resultStatus);
  set("costTimeMax", opts.costTimeMaxMs, (v) => Number(v) * 1_000_000);
  set("costTimeMin", opts.costTimeMinMs, (v) => Number(v) * 1_000_000);
  set("supplier", opts.supplier);
}

/** The option block shared by `logs query` and `sessions list` (LogQuery). */
function addLogQueryOptions(cmd: Command): Command {
  return cmd
    .option("--start-time <rfc3339>", "Start time (RFC3339, e.g. 2026-10-04T00:00:00Z)")
    .option("--end-time <rfc3339>", "End time (RFC3339)")
    .option("--ids <ids>", "Comma-separated log IDs")
    .option("--search-log-id <id>", "Log ID search term")
    .option("--search-session-id <id>", "Session ID search term")
    .option("--search-order-ref <ref>", "Order reference search term")
    .option("--user-id <id>", "Filter by user entity ID")
    .option("--seller-entity-id <id>", "Filter by seller entity ID")
    .option("--buyer-entity-id <id>", "Filter by buyer entity ID")
    .option("--hotel-id <id>", "Filter by hotel ID")
    .option("--order-id <id>", "Filter by order ID")
    .option("--supplier-biz-id <id>", "Filter by supplier business ID")
    .option("--supplier-biz-type <n>", "Filter by supplier biz type code")
    .option("--api-in-path <path>", "Filter by inbound API path")
    .option("--api-out-supplier <name>", "Filter by outbound supplier name")
    .option("--api-out-path <path>", "Filter by outbound API path")
    .option("--biz-error-code <code>", "Filter by business error code")
    .option("--input-header-key <key>", "Filter by input header key")
    .option("--input-header-value <value>", "Filter by input header value")
    .option("--input-body-keyword <kw>", "Keyword in request body")
    .option("--output-body-keyword <kw>", "Keyword in response body")
    .option("--output-http-status-code <n>", "Filter by output HTTP status code")
    .addOption(new Option("--result-status <status>", "Filter by result status").choices(["success", "failed", "timeout", "partial"]))
    .option("--cost-time-max-ms <ms>", "Max cost time in milliseconds")
    .option("--cost-time-min-ms <ms>", "Min cost time in milliseconds")
    .option("--supplier <name>", "Filter by supplier name");
}

export function createBiCommand(ctx: Ctx): Command {
  const bi = new Command("bi").description("BI log troubleshooting and order analytics");

  const logs = bi.command("logs").description("Structured API log queries");
  addLogQueryOptions(
    logs
      .command("query")
      .description("Query logs (bi/log queryLogs)")
      .option("--page-num <n>", "Page number", "1")
      .option("--page-size <n>", "Page size", "20")
      .option("--load-output-body", "Load response bodies", false),
  ).action(async (opts) => {
    const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
    if (opts.loadOutputBody) body.loadOutputBody = true;
    applyLogQueryFilters(body, opts);
    await run(ctx, "/api/bi/log/queryLogs", body);
  });

  const sessions = bi.command("sessions").description("Request session inspection");

  addLogQueryOptions(
    sessions
      .command("list")
      .description("List sessions (bi/log getSessionList)")
      .option("--page-num <n>", "Page number", "1")
      .option("--page-size <n>", "Page size", "20")
      .option("--exclude-single-logs", "Exclude logs without a sessionId", false)
      .option("--include-session-meta", "Load session metadata from persistent storage", false),
  ).action(async (opts) => {
    const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
    if (opts.excludeSingleLogs) body.excludeSingleLogs = true;
    if (opts.includeSessionMeta) body.includeSessionMeta = true;
    applyLogQueryFilters(body, opts);
    await run(ctx, "/api/bi/log/getSessionList", body);
  });

  sessions
    .command("get")
    .description("Get one session with its logs (bi/log getSession)")
    .option("--session-id <id>", "Session ID (or --trace-id)")
    .option("--trace-id <id>", "Trace ID — resolves the session when no --session-id")
    .option("--user-id <id>", "User entity ID (session owner scope)")
    .option("--load-output-body", "Load response bodies", false)
    .option("--trace-scope", "With --trace-id: only that trace's logs, not the whole session", false)
    .action(async (opts) => {
      if (!opts.sessionId && !opts.traceId) {
        error("--session-id or --trace-id is required", ctx.jsonMode());
        process.exit(1);
      }
      const body: any = {};
      if (opts.sessionId) body.id = opts.sessionId;
      if (opts.traceId) body.searchTraceId = opts.traceId;
      if (opts.userId) body.userId = opts.userId;
      if (opts.loadOutputBody) body.loadOutputBody = true;
      if (opts.traceScope) body.traceScope = true;
      await run(ctx, "/api/bi/log/getSession", body);
    });

  sessions
    .command("related")
    .description("Related failure sessions (bi/log getRelatedSessions)")
    .option("--session-id <id>", "Anchor session ID")
    .option("--trace-id <id>", "Anchor trace ID")
    .option("--time-window-min <n>", "Look-back window in minutes")
    .option("--max-results <n>", "Max sessions returned")
    .action(async (opts) => {
      // FindMemoryFailuresInput (agent/domain/memory.go) has no json tags —
      // the canonical wire keys are the Go field names.
      const body: any = {};
      if (opts.sessionId) body.SessionID = opts.sessionId;
      if (opts.traceId) body.TraceID = opts.traceId;
      if (opts.timeWindowMin !== undefined) body.TimeWindowMin = parseInt(opts.timeWindowMin, 10);
      if (opts.maxResults !== undefined) body.MaxResults = parseInt(opts.maxResults, 10);
      await run(ctx, "/api/bi/log/getRelatedSessions", body);
    });

  const incidents = bi.command("incidents").description("Incident clustering");

  incidents
    .command("clusters")
    .description("Active incident clusters (bi/log getIncidentClusters)")
    .option("--time-window-min <n>", "Look-back window in minutes")
    .option("--max-results <n>", "Max clusters returned")
    .addOption(new Option("--min-severity <sev>", "Minimum severity").choices(["p0", "p1", "p2"]))
    .action(async (opts) => {
      const body: any = {};
      if (opts.timeWindowMin !== undefined) body.timeWindowMin = parseInt(opts.timeWindowMin, 10);
      if (opts.maxResults !== undefined) body.maxResults = parseInt(opts.maxResults, 10);
      if (opts.minSeverity) body.minSeverity = opts.minSeverity;
      await run(ctx, "/api/bi/log/getIncidentClusters", body);
    });

  bi
    .command("order-analytics")
    .description("Order analytics overview/trend (bi/order getOrderAnalytics)")
    .option("--start-date <rfc3339>", "Start date (RFC3339)")
    .option("--end-date <rfc3339>", "End date (RFC3339)")
    .addOption(new Option("--granularity <g>", "Bucket size").choices(["day", "week", "month"]))
    .option("--status-filter <codes>", "Comma-separated order status codes")
    .option("--entity-id <id>", "Entity ID scope")
    .action(async (opts) => {
      const body: any = {};
      if (opts.startDate) body.startDate = opts.startDate;
      if (opts.endDate) body.endDate = opts.endDate;
      if (opts.granularity) body.granularity = opts.granularity;
      if (opts.statusFilter) body.statusFilter = opts.statusFilter.split(",").map((s: string) => Number(s.trim()));
      if (opts.entityId) body.entityId = opts.entityId;
      await run(ctx, "/api/bi/order/getOrderAnalytics", body);
    });

  return bi;
}
