/**
 * commands/api.ts — L0 generic passthrough (issue #29).
 *
 * api catalog [--filter substr] [--service name] [--refresh]   discovery
 * api describe <path|service/method>                           single-endpoint metadata
 * api call <path> [--data inline|@file.json] [--confirm]       authed POST to any /api/ JSON endpoint
 *
 * The guardrail model (architecture D3/D5): auth and RBAC stay server-side;
 * the CLI only classifies write operations (catalog operationType, falling
 * back to a method-name heuristic) and demands --confirm before executing
 * them. Read operations pass straight through.
 */

import { Command } from "commander";
import { run, parseJsonInput, makeClient, type Ctx } from "./helpers.ts";
import { emit, error } from "../utils/output.ts";
import {
  findMethodMeta,
  isWriteOperation,
  loadCatalog,
  methodNameFromPath,
  normalizeApiPath,
  type ApiCatalogCtx,
  type MethodMeta,
} from "../core/api_catalog.ts";

function catalogCtx(ctx: Ctx): ApiCatalogCtx {
  return { env: ctx.env, client: () => makeClient(ctx) };
}

/** operationType as shown to humans: server value, or the heuristic verdict. */
function effectiveOperationType(meta: Pick<MethodMeta, "operationType" | "methodName">): string {
  if (meta.operationType === "write" || meta.operationType === "read") return meta.operationType;
  return isWriteOperation(meta) ? "write (heuristic)" : "read (heuristic)";
}

function printCatalogTable(methods: MethodMeta[]): void {
  const rows = methods.map((m) => ({
    path: m.path ?? "",
    service: m.serviceName ?? "",
    method: m.methodName ?? "",
    operationType: effectiveOperationType(m),
  }));
  const widths = {
    path: Math.max("PATH".length, ...rows.map((r) => r.path.length)),
    service: Math.max("SERVICE".length, ...rows.map((r) => r.service.length)),
    method: Math.max("METHOD".length, ...rows.map((r) => r.method.length)),
    operationType: Math.max("OPERATION".length, ...rows.map((r) => r.operationType.length)),
  };
  const line = (cells: string[]) =>
    console.log(`${cells[0].padEnd(widths.path)}  ${cells[1].padEnd(widths.service)}  ${cells[2].padEnd(widths.method)}  ${cells[3]}`);
  line(["PATH", "SERVICE", "METHOD", "OPERATION"]);
  console.log(`${"-".repeat(widths.path)}  ${"-".repeat(widths.service)}  ${"-".repeat(widths.method)}  ${"-".repeat(widths.operationType)}`);
  for (const r of rows) line([r.path, r.service, r.method, r.operationType]);
}

function printDescribe(meta: MethodMeta): void {
  const list = (label: string, values: unknown): void => {
    if (values === undefined || values === null) return;
    const text = Array.isArray(values) ? values.join(", ") : String(values);
    console.log(`${label.padEnd(14)}${text}`);
  };
  console.log(`${meta.path}  (${effectiveOperationType(meta)})`);
  list("service", `${meta.serviceName}/${meta.methodName}`);
  list("auth", meta.authMethod);
  list("permissions", meta.permissions);
  list("params", meta.paramNames);
  list("validations", meta.validations === undefined ? undefined : JSON.stringify(meta.validations));
  if (meta.apidoc) console.log(`apidoc:\n${meta.apidoc.split("\n").map((l) => `  ${l}`).join("\n")}`);
}

export function createApiCommand(ctx: Ctx): Command {
  const api = new Command("api").description("Generic passthrough to any /api/ JSON endpoint (catalog / describe / call)");

  api
    .command("catalog")
    .description("List the server endpoint catalog (cached 24h; --refresh re-pulls)")
    .option("--filter <substr>", "Case-insensitive substring filter on path/service/method")
    .option("--service <name>", "Exact service name filter (case-insensitive)")
    .option("--refresh", "Force a fresh catalog pull, ignoring the cache", false)
    .action(async (opts) => {
      try {
        const snapshot = await loadCatalog(catalogCtx(ctx), { refresh: opts.refresh });
        let methods = snapshot.methods;
        if (opts.service) {
          const service = String(opts.service).toLowerCase();
          methods = methods.filter((m) => (m.serviceName ?? "").toLowerCase() === service);
        }
        if (opts.filter) {
          const needle = String(opts.filter).toLowerCase();
          methods = methods.filter((m) =>
            `${m.path ?? ""} ${m.serviceName ?? ""} ${m.methodName ?? ""}`.toLowerCase().includes(needle)
          );
        }
        if (ctx.jsonMode()) {
          emit(methods, true);
        } else {
          printCatalogTable(methods);
          console.log(
            `${methods.length} method(s) · source: ${snapshot.source}${snapshot.stale ? " (stale fallback)" : ""} · fetched ${new Date(snapshot.fetchedAt).toISOString()}`
          );
        }
      } catch (e: any) {
        error(e.message, ctx.jsonMode());
        process.exit(1);
      }
    });

  api
    .command("describe <target>")
    .description("Print one endpoint's metadata (accepts /api/a/b/c or service/method)")
    .action(async (target) => {
      try {
        const snapshot = await loadCatalog(catalogCtx(ctx));
        const meta = findMethodMeta(snapshot.methods, target);
        if (!meta) {
          error(`endpoint "${target}" not found in the catalog (try: hbcli api catalog --filter <substr>)`, ctx.jsonMode());
          process.exit(1);
        }
        if (ctx.jsonMode()) emit(meta, true);
        else printDescribe(meta);
      } catch (e: any) {
        error(e.message, ctx.jsonMode());
        process.exit(1);
      }
    });

  api
    .command("call <path>")
    .description("Authed POST to any /api/ JSON endpoint (write operations require --confirm)")
    .option("--data <json>", "Request body JSON object, or @file.json (default {})")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (path, opts) => {
      let target: string;
      try {
        target = normalizeApiPath(path);
      } catch (e: any) {
        error(e.message, ctx.jsonMode());
        process.exit(1);
      }

      let body: Record<string, unknown> = {};
      if (opts.data !== undefined) {
        const parsed = parseJsonInput(opts.data);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          error(`--data must be a JSON object or @file.json (got: ${String(opts.data).slice(0, 80)})`, ctx.jsonMode());
          process.exit(1);
        }
        body = parsed as Record<string, unknown>;
      }

      // Write guard: classify from the catalog when available; otherwise the
      // method-name heuristic on the path's last segment. --confirm short-
      // circuits the guard (and the catalog lookup) entirely.
      if (!opts.confirm) {
        let meta: MethodMeta | undefined;
        try {
          meta = findMethodMeta((await loadCatalog(catalogCtx(ctx))).methods, target);
        } catch (e: any) {
          const reason = String(e?.message ?? e).split("\n")[0];
          console.error(`note: catalog unavailable (${reason}); classifying "${target}" by method-name heuristic`);
        }
        const probe = { operationType: meta?.operationType, methodName: meta?.methodName ?? methodNameFromPath(target) };
        if (isWriteOperation(probe)) {
          const basis = probe.operationType
            ? `operationType=${probe.operationType}`
            : `method name "${probe.methodName}" is not on the read-prefix list`;
          error(`${target} looks like a WRITE operation (${basis}). Re-run with --confirm to execute.`, ctx.jsonMode());
          process.exit(1);
        }
      }

      await run(ctx, target, body);
    });

  return api;
}
