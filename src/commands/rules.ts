/**
 * commands/rules.ts — rule engine administration (BFF/PaaS/Rule).
 *
 * rules list        List rules visible to you (optionally family/phase filtered)
 * rules get         Get one rule by ID
 * rules metadata    Get rule authoring metadata (factor + action definitions)
 * rules factors     Get factor metadata (factor definitions + data sources)
 * rules families    List rule families and their default phases
 * rules upsert      Create or update a rule (write — requires --confirm)
 * rules simulate    Simulate a condition/aim pair against sample factors (write — requires --confirm)
 *
 * All endpoints are rule-service methods verified against the live method
 * registry (`/api/view/getApiPaths type=rule`) and the source contracts in
 * rule/service/rule.go (getRules/getRule/upsertRule/simulateRule),
 * rule/service/family_service.go (getRuleFamilies/getRulesFiltered),
 * rule/service/metadata.go + rule_metadata.go (getRuleMetadata/getFactorMetadata).
 *
 * Note: the internal EvaluatePipeline family (rule/service/family_service.go)
 * is Go-internal only (`@apidoc: -`, absent from the live registry) —
 * `rules simulate` is the HTTP evaluation surface.
 *
 * Write confirmation follows the `catalogs` guardrail model: known writes
 * refuse to execute without an explicit --confirm.
 */

import { Command } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";
import { readFileSync } from "node:fs";

/** Write guard shared by upsert / simulate (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

/**
 * SimulateRuleReq.params is a JSON *string* on the wire (rule/protocol/rule.go).
 * `@file.json` splices the file text in verbatim; other values pass through as-is.
 */
function paramsText(value: string): string {
  if (value.startsWith("@")) return readFileSync(value.slice(1), "utf8");
  return value;
}

export function createRulesCommand(ctx: Ctx): Command {
  const rules = new Command("rules").description("Rule engine: list, inspect, upsert and simulate pricing/business rules");

  rules
    .command("list")
    .description("List rules (Platform users see all; tenants see their own)")
    .option("--family <family>", "Filter by rule family (case-insensitive)")
    .option("--phase <phase>", "Filter by rule phase (case-insensitive)")
    .action(async (opts) => {
      if (opts.family || opts.phase) {
        const body: any = {};
        if (opts.family) body.family = opts.family;
        if (opts.phase) body.phase = opts.phase;
        await run(ctx, "/api/rule/getRulesFiltered", body);
        return;
      }
      await run(ctx, "/api/rule/getRules", {});
    });

  rules
    .command("get")
    .description("Get one rule by ID")
    .requiredOption("--id <n>", "Rule ID")
    .action(async (opts) => {
      await run(ctx, "/api/rule/getRule", { id: parseInt(opts.id, 10) });
    });

  rules
    .command("metadata")
    .description("Get rule authoring metadata (factor + action definitions)")
    .action(async () => {
      await run(ctx, "/api/rule/getRuleMetadata", {});
    });

  rules
    .command("factors")
    .description("Get factor metadata (definitions + static/API data sources)")
    .action(async () => {
      await run(ctx, "/api/rule/getFactorMetadata", {});
    });

  rules
    .command("families")
    .description("List rule families with their default phases")
    .action(async () => {
      await run(ctx, "/api/rule/getRuleFamilies", {});
    });

  rules
    .command("upsert")
    .description("Create or update a rule (write operation — requires --confirm)")
    .requiredOption("--data <json>", "Rule JSON (domain.Rule shape), or @file.json")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "rules upsert", opts.confirm);
      await run(ctx, "/api/rule/upsertRule", parseJsonInput(opts.data));
    });

  rules
    .command("simulate")
    .description("Simulate condition + aim against sample factors (write operation — requires --confirm)")
    .requiredOption("--condition <expr>", "Condition expression (Arishem JSON)")
    .requiredOption("--params <json>", "Factor params JSON string (basePrice enables price preview), or @file.json")
    .requiredOption("--aim <expr>", "Aim expression (markup strategy JSON)")
    .option("--family <family>", "Family declared for this simulation (result context only)")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "rules simulate", opts.confirm);
      const body: any = { condition: opts.condition, params: paramsText(opts.params), aim: opts.aim };
      if (opts.family) body.family = opts.family;
      await run(ctx, "/api/rule/simulateRule", body);
    });

  return rules;
}
