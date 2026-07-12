/**
 * commands/portal/users.ts — tenant user management.
 */

import { Command } from "commander";
import { runPortal, type Ctx } from "./helpers.ts";
import { parseJsonInput } from "../../utils/output.ts";

export function createPortalUsersCommand(ctx: Ctx): Command {
  const users = new Command("users").description("Tenant user management (invite, list, update, roles)");

  users
    .command("list")
    .description("List tenant users")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      await runPortal(ctx, "/api/user/tenant/listUser", {
        pageNum: parseInt(opts.pageNum),
        pageSize: parseInt(opts.pageSize),
      });
    });

  users
    .command("get")
    .description("Get a single user by ID")
    .requiredOption("--user-id <id>", "User ID")
    .action(async (opts) => {
      await runPortal(ctx, "/api/user/tenant/getUser", { userId: opts.userId });
    });

  users
    .command("invite")
    .description("Invite a user to the tenant")
    .requiredOption("--email <email>", "Invitee email")
    .option("--role-id <id>", "Role ID to assign")
    .option("--name <name>", "Display name")
    .action(async (opts) => {
      const body: any = { email: opts.email };
      if (opts.roleId) body.roleId = opts.roleId;
      if (opts.name) body.name = opts.name;
      await runPortal(ctx, "/api/user/tenant/inviteUser", body);
    });

  users
    .command("batch-invite")
    .description("Batch invite users from a JSON file")
    .requiredOption("--file <path>", "JSON file with invite list, or @file.json")
    .action(async (opts) => {
      const path = opts.file.startsWith("@") ? opts.file.slice(1) : opts.file;
      const invites = JSON.parse(Bun.file(path).textSync());
      await runPortal(ctx, "/api/user/tenant/batchInviteUser", { invites });
    });

  users
    .command("update")
    .description("Update a tenant user")
    .requiredOption("--user-id <id>", "User ID")
    .option("--name <name>", "New display name")
    .option("--role-id <id>", "New role ID")
    .action(async (opts) => {
      const body: any = { userId: opts.userId };
      if (opts.name) body.name = opts.name;
      if (opts.roleId) body.roleId = opts.roleId;
      await runPortal(ctx, "/api/user/tenant/updateUser", body);
    });

  users
    .command("list-roles")
    .description("List roles available to the tenant")
    .action(async () => {
      await runPortal(ctx, "/api/user/tenant/listRole", {});
    });

  users
    .command("list-team-members")
    .description("List team members for the current tenant")
    .action(async () => {
      await runPortal(ctx, "/api/user/tenant/listTeamMembers", {});
    });

  return users;
}