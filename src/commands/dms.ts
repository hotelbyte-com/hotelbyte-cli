/**
 * commands/dms.ts — data management surface: MySQL / Redis / TDengine /
 * MinIO-adjacent environments, queries and query history.
 *
 * Backed by the dispatcher service "dms" (dms/service/*.go). Paths verified
 * against the live getApiPaths catalog (2026-10-04). Reads carry
 * system:dms:read; writes carry system:dms:write plus a server-side
 * confirmation string "<environment>/<dataSource>/<type>"
 * (dms/service/service.go writeConfirm) — the CLI computes it once --confirm
 * is passed, mirroring the portal UI.
 *
 * dms datasources environments  List configured environments
 * dms datasources list          List data sources (per environment)
 * dms datasources check         Health-check a data source
 * dms mysql query               Run a read-only SQL query
 * dms mysql schema              Inspect databases/tables/columns
 * dms mysql exec                Execute a write statement (write — requires --confirm)
 * dms redis get                 Get one key
 * dms redis keys                Scan keys by pattern
 * dms redis set                 Set a key (write — requires --confirm)
 * dms redis delete              Delete a key (write — requires --confirm)
 * dms tdengine query            Run a TDengine SQL query
 * dms query-history             Recent queries of the current user
 *
 * Write confirmation follows the `catalogs` guardrail model: known writes
 * refuse to execute without an explicit --confirm.
 */

import { Command, Option } from "commander";
import { run, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by mysql exec / redis set / redis delete (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

/** Server-side write confirmation token (dms writeConfirm): env/ds/type. */
function writeConfirmToken(environment: string, dataSource: string, dataSourceType: string): string {
  return `${environment}/${dataSource}/${dataSourceType}`;
}

export function createDmsCommand(ctx: Ctx): Command {
  const dms = new Command("dms").description("Data management: MySQL/Redis/TDengine queries and history");

  const datasources = dms.command("datasources").description("DMS environments and data sources");

  datasources
    .command("environments")
    .description("List configured environments")
    .action(async () => {
      await run(ctx, "/api/dms/environments", {});
    });

  datasources
    .command("list")
    .description("List data sources")
    .option("--environment <name>", "Filter by environment")
    .action(async (opts) => {
      const body: any = {};
      if (opts.environment) body.environment = opts.environment;
      await run(ctx, "/api/dms/dataSources", body);
    });

  datasources
    .command("check")
    .description("Health-check a data source")
    .requiredOption("--environment <name>", "Environment name")
    .requiredOption("--data-source <name>", "Data source name")
    .action(async (opts) => {
      await run(ctx, "/api/dms/dataSource/check", { environment: opts.environment, dataSource: opts.dataSource });
    });

  const mysql = dms.command("mysql").description("MySQL data sources");

  mysql
    .command("query")
    .description("Run a read-only SQL query")
    .requiredOption("--environment <name>", "Environment name")
    .requiredOption("--data-source <name>", "Data source name")
    .requiredOption("--sql <sql>", "SQL to execute")
    .option("--limit <n>", "Max rows", "50")
    .action(async (opts) => {
      await run(ctx, "/api/dms/mysql/query", {
        environment: opts.environment,
        dataSource: opts.dataSource,
        sql: opts.sql,
        limit: parseInt(opts.limit, 10),
      });
    });

  mysql
    .command("schema")
    .description("Inspect databases, tables and columns")
    .requiredOption("--environment <name>", "Environment name")
    .requiredOption("--data-source <name>", "Data source name")
    .option("--database <name>", "Scope to one database")
    .option("--table <name>", "Scope to one table")
    .action(async (opts) => {
      const body: any = { environment: opts.environment, dataSource: opts.dataSource };
      if (opts.database) body.database = opts.database;
      if (opts.table) body.table = opts.table;
      await run(ctx, "/api/dms/mysql/schema", body);
    });

  mysql
    .command("exec")
    .description("Execute a write statement (write operation — requires --confirm)")
    .requiredOption("--environment <name>", "Environment name")
    .requiredOption("--data-source <name>", "Data source name")
    .requiredOption("--sql <sql>", "Write statement (INSERT/UPDATE/DELETE/DDL)")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "dms mysql exec", opts.confirm);
      await run(ctx, "/api/dms/mysql/exec", {
        environment: opts.environment,
        dataSource: opts.dataSource,
        sql: opts.sql,
        confirm: writeConfirmToken(opts.environment, opts.dataSource, "mysql"),
      });
    });

  const redis = dms.command("redis").description("Redis data sources");

  redis
    .command("get")
    .description("Get one key")
    .requiredOption("--environment <name>", "Environment name")
    .requiredOption("--data-source <name>", "Data source name")
    .requiredOption("--key <key>", "Key to read")
    .option("--limit <n>", "Max bytes/value length")
    .action(async (opts) => {
      const body: any = { environment: opts.environment, dataSource: opts.dataSource, key: opts.key };
      if (opts.limit !== undefined) body.limit = parseInt(opts.limit, 10);
      await run(ctx, "/api/dms/redis/get", body);
    });

  redis
    .command("keys")
    .description("Scan keys by pattern")
    .requiredOption("--environment <name>", "Environment name")
    .requiredOption("--data-source <name>", "Data source name")
    .option("--pattern <pattern>", "Key pattern", "*")
    .option("--limit <n>", "Max keys")
    .action(async (opts) => {
      const body: any = { environment: opts.environment, dataSource: opts.dataSource, pattern: opts.pattern };
      if (opts.limit !== undefined) body.limit = parseInt(opts.limit, 10);
      await run(ctx, "/api/dms/redis/keys", body);
    });

  redis
    .command("set")
    .description("Set a key (write operation — requires --confirm)")
    .requiredOption("--environment <name>", "Environment name")
    .requiredOption("--data-source <name>", "Data source name")
    .requiredOption("--key <key>", "Key to write")
    .requiredOption("--value <value>", "Value to write")
    .option("--ttl-seconds <n>", "Expiration in seconds")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "dms redis set", opts.confirm);
      const body: any = {
        environment: opts.environment,
        dataSource: opts.dataSource,
        key: opts.key,
        value: opts.value,
        confirm: writeConfirmToken(opts.environment, opts.dataSource, "redis"),
      };
      if (opts.ttlSeconds !== undefined) body.ttlSeconds = parseInt(opts.ttlSeconds, 10);
      await run(ctx, "/api/dms/redis/set", body);
    });

  redis
    .command("delete")
    .description("Delete a key (write operation — requires --confirm)")
    .requiredOption("--environment <name>", "Environment name")
    .requiredOption("--data-source <name>", "Data source name")
    .requiredOption("--key <key>", "Key to delete")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "dms redis delete", opts.confirm);
      await run(ctx, "/api/dms/redis/delete", {
        environment: opts.environment,
        dataSource: opts.dataSource,
        key: opts.key,
        confirm: writeConfirmToken(opts.environment, opts.dataSource, "redis"),
      });
    });

  const tdengine = dms.command("tdengine").description("TDengine data sources");

  tdengine
    .command("query")
    .description("Run a TDengine SQL query")
    .requiredOption("--environment <name>", "Environment name")
    .requiredOption("--data-source <name>", "Data source name")
    .requiredOption("--sql <sql>", "SQL to execute")
    .option("--limit <n>", "Max rows", "50")
    .action(async (opts) => {
      await run(ctx, "/api/dms/tdengine/query", {
        environment: opts.environment,
        dataSource: opts.dataSource,
        sql: opts.sql,
        limit: parseInt(opts.limit, 10),
      });
    });

  dms
    .command("query-history")
    .description("Recent queries of the current user")
    .option("--environment <name>", "Filter by environment")
    .option("--data-source <name>", "Filter by data source")
    .addOption(new Option("--type <type>", "Filter by data source type").choices(["mysql", "redis", "tdengine", "minio"]))
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "50")
    .action(async (opts) => {
      const body: any = { page: { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) } };
      if (opts.environment) body.environment = opts.environment;
      if (opts.dataSource) body.dataSource = opts.dataSource;
      if (opts.type) body.type = opts.type;
      await run(ctx, "/api/dms/history", body);
    });

  return dms;
}
