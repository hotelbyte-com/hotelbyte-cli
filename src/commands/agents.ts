/**
 * commands/agents.ts — agent management plane (runs / skills / knowledge / dispatch).
 *
 * agents runs list         List agent runs for one profile
 * agents runs get          Get one run with its messages, actions, jobs, audits
 * agents runs messages     Send a user message to a run (write — requires --confirm)
 * agents skills list       List marketplace + tenant/user skills
 * agents skills get        Get one skill's content (export projection)
 * agents knowledge tree    Show the tenant/profile knowledge tree
 * agents dispatch          Confirm + execute a pending run action (write — requires --confirm)
 *
 * All endpoints are bi/agent service methods verified against the live
 * method registry (`/api/view/getApiPaths type=bi/agent`) and the source
 * contracts in agent/service/api.go:
 *   listAgentRuns / getAgentRun (agent_runs_api.go),
 *   sendAgentMessage (agent_messages_api.go), listAgentSkills /
 *   exportAgentSkill / listAgentKnowledgeTree (agent_knowledge_protocol.go),
 *   confirmAgentAction (agent_actions_api.go — the management-plane write
 *   that dispatches a pending action into a job; there is no /dispatch path).
 *
 * Streaming conversation (createAgentRunStream / sendAgentMessageStream) is
 * deliberately out of scope here — use `api call` for the hosted surface.
 *
 * Write confirmation follows the `catalogs` guardrail model: known writes
 * refuse to execute without an explicit --confirm.
 */

import { Command } from "commander";
import { run, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by runs messages / dispatch (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

export function createAgentsCommand(ctx: Ctx): Command {
  const agents = new Command("agents").description("Agent management plane: runs, skills, knowledge, dispatch");

  const runs = new Command("runs").description("Agent run management");

  runs
    .command("list")
    .description("List runs visible to you for one agent profile")
    .requiredOption("--profile-id <id>", "Agent profile ID")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size (max 100)", "20")
    .action(async (opts) => {
      const body: any = {
        profileId: opts.profileId,
        pageNum: parseInt(opts.pageNum, 10),
        pageSize: parseInt(opts.pageSize, 10),
      };
      await run(ctx, "/api/bi/agent/listAgentRuns", body);
    });

  runs
    .command("get")
    .description("Get one run with messages, actions, jobs and audits")
    .requiredOption("--run-id <id>", "Run ID")
    .option("--page-num <n>", "Message page number", "1")
    .option("--page-size <n>", "Message page size", "20")
    .action(async (opts) => {
      const body: any = {
        runId: opts.runId,
        pageNum: parseInt(opts.pageNum, 10),
        pageSize: parseInt(opts.pageSize, 10),
      };
      await run(ctx, "/api/bi/agent/getAgentRun", body);
    });

  runs
    .command("messages")
    .description("Send a user message to a run and get the assistant reply (write operation — requires --confirm)")
    .requiredOption("--run-id <id>", "Run ID")
    .requiredOption("--message <text>", "User message text")
    .option("--idempotency-key <key>", "Idempotency key (dedupe retries)")
    .option("--model <model>", "Model override for this turn")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "agents runs messages", opts.confirm);
      const body: any = { runId: opts.runId, userMessage: opts.message };
      if (opts.idempotencyKey) body.idempotencyKey = opts.idempotencyKey;
      if (opts.model) body.modelOverride = opts.model;
      await run(ctx, "/api/bi/agent/sendAgentMessage", body);
    });

  agents.addCommand(runs);

  const skills = new Command("skills").description("Agent skills (marketplace + tenant/user)");

  skills
    .command("list")
    .description("List marketplace and tenant/user-created skills")
    .option("--profile-id <id>", "Agent profile ID (omit for all)")
    .action(async (opts) => {
      const body: any = {};
      if (opts.profileId) body.profileId = opts.profileId;
      await run(ctx, "/api/bi/agent/listAgentSkills", body);
    });

  skills
    .command("get")
    .description("Get one skill's current content")
    .requiredOption("--skill-id <id>", "Skill ID")
    .option("--profile-id <id>", "Agent profile ID (omit for marketplace skills)")
    .action(async (opts) => {
      const body: any = { skillId: opts.skillId };
      if (opts.profileId) body.profileId = opts.profileId;
      await run(ctx, "/api/bi/agent/exportAgentSkill", body);
    });

  agents.addCommand(skills);

  agents
    .command("knowledge")
    .description("Knowledge base operations")
    .command("tree")
    .description("Show the tenant/profile knowledge tree")
    .option("--profile-id <id>", "Agent profile ID (omit for default scope)")
    .action(async (opts) => {
      const body: any = {};
      if (opts.profileId) body.profileId = opts.profileId;
      await run(ctx, "/api/bi/agent/listAgentKnowledgeTree", body);
    });

  agents
    .command("dispatch")
    .description("Confirm a pending run action and execute it as a job (write operation — requires --confirm)")
    .requiredOption("--run-id <id>", "Run ID")
    .requiredOption("--action-id <id>", "Pending action ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "agents dispatch", opts.confirm);
      await run(ctx, "/api/bi/agent/confirmAgentAction", { runId: opts.runId, actionId: opts.actionId });
    });

  return agents;
}
