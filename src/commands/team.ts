/**
 * commands/team.ts — team member management (admin-facing).
 *
 * team list           List team members
 * team list-roles     List roles available to the tenant
 * team invite         Invite a user
 * team batch-invite   Batch invite from a JSON file
 * team get            Get a user by ID
 * team update         Update a user
 */

import { Command } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";

export function createTeamCommand(ctx: Ctx): Command {
  const team = new Command("team").description("Team member and role management");

  team
    .command("list")
    .description("List team members")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      await run(ctx, "/api/user/tenant/listUser", {
        pageNum: parseInt(opts.pageNum),
        pageSize: parseInt(opts.pageSize),
      });
    });

  team
    .command("list-roles")
    .description("List roles available to the tenant")
    .action(async () => {
      await run(ctx, "/api/user/tenant/listRole", {});
    });

  team
    .command("invite")
    .description("Invite a user to the team")
    .requiredOption("--email <email>", "Invitee email")
    .option("--role-id <id>", "Role ID to assign")
    .option("--name <name>", "Display name")
    .action(async (opts) => {
      const body: any = { email: opts.email };
      if (opts.roleId) body.roleId = opts.roleId;
      if (opts.name) body.name = opts.name;
      await run(ctx, "/api/user/tenant/inviteUser", body);
    });

  team
    .command("batch-invite")
    .description("Batch invite users from a JSON file")
    .requiredOption("--file <path>", "JSON file with invite list, or @file.json")
    .action(async (opts) => {
      const path = opts.file.startsWith("@") ? opts.file.slice(1) : opts.file;
      const invites = JSON.parse(Bun.file(path).textSync());
      await run(ctx, "/api/user/tenant/batchInviteUser", { invites });
    });

  team
    .command("get")
    .description("Get a user by ID")
    .requiredOption("--user-id <id>", "User ID")
    .action(async (opts) => {
      await run(ctx, "/api/user/tenant/getUser", { userId: opts.userId });
    });

  team
    .command("update")
    .description("Update a user")
    .requiredOption("--user-id <id>", "User ID")
    .option("--name <name>", "New display name")
    .option("--role-id <id>", "New role ID")
    .action(async (opts) => {
      const body: any = { userId: opts.userId };
      if (opts.name) body.name = opts.name;
      if (opts.roleId) body.roleId = opts.roleId;
      await run(ctx, "/api/user/tenant/updateUser", body);
    });

  return team;
}
