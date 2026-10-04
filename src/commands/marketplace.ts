/**
 * commands/marketplace.ts — entity connections: links, approvals, applications.
 *
 * marketplace links by-buyer       List entity links where the entity is the buyer
 * marketplace links by-seller      List entity links where the entity is the seller
 * marketplace approvals pending    List pending marketplace approvals
 * marketplace approvals process    Approve/reject/request-info/cancel (write — requires --confirm)
 * marketplace applications list    List connection applications (buyer/seller/type/status filters)
 * marketplace applications by-entity  List applications touching one entity
 *
 * Routes (verified against the live method directory, service user/tenant):
 * listEntityEntityLinksByBuyer / listEntityEntityLinksBySeller
 * (user/service/user_misc.go), getPendingApprovals / processApproval /
 * listConnectionApplications / getApplicationsByEntity
 * (user/service/marketplace.go).
 *
 * Contract notes:
 *  - The scalar-param methods bind body keys by the Go parameter names
 *    (httpdispatcher parseArgsInternal → AST fallback): links take
 *    {buyerEntityId} / {sellerEntityId}; by-entity takes {entityId, role}.
 *  - Approval actions are approve/reject/request_info/cancel
 *    (user/domain/approval_action.go); application statuses are
 *    1=pending 2=under_review 3=approved 4=rejected 5=cancelled
 *    (user/domain/marketplace_application.go).
 *
 * Write confirmation follows the `catalogs` guardrail: known writes refuse to
 * execute without an explicit --confirm.
 */

import { Command, Option } from "commander";
import { run, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

const BASE = "/api/user/tenant";

export function createMarketplaceCommand(ctx: Ctx): Command {
  const marketplace = new Command("marketplace").description("Entity connections: links, approvals, applications");

  // ── links ─────────────────────────────────────────────────────────────
  const links = marketplace.command("links").description("Established entity-to-entity links");

  links
    .command("by-buyer")
    .description("List links where the given entity is the buyer (tenant side)")
    .requiredOption("--buyer-entity-id <id>", "Buyer entity ID")
    .action(async (opts) => {
      await run(ctx, `${BASE}/listEntityEntityLinksByBuyer`, { buyerEntityId: opts.buyerEntityId });
    });

  links
    .command("by-seller")
    .description("List links where the given entity is the seller (customer side)")
    .requiredOption("--seller-entity-id <id>", "Seller entity ID")
    .action(async (opts) => {
      await run(ctx, `${BASE}/listEntityEntityLinksBySeller`, { sellerEntityId: opts.sellerEntityId });
    });

  // ── approvals ─────────────────────────────────────────────────────────
  const approvals = marketplace.command("approvals").description("Marketplace approval inbox");

  approvals
    .command("pending")
    .description("List pending approvals (optionally narrowed to one approver entity)")
    .option("--approver-entity-id <id>", "Approver entity ID (omit for all pending)")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { page: { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) } };
      if (opts.approverEntityId) body.approverEntityId = opts.approverEntityId;
      await run(ctx, `${BASE}/getPendingApprovals`, body);
    });

  approvals
    .command("process")
    .description("Approve / reject / request-info / cancel an application (write operation — requires --confirm)")
    .requiredOption("--application-id <id>", "Application ID")
    .requiredOption("--approver-entity-id <id>", "Approver entity ID (must hold the approval privilege)")
    .addOption(
      new Option("--action <action>", "Approval action")
        .choices(["approve", "reject", "request_info", "cancel"])
        .makeOptionMandatory(),
    )
    .option("--comment <text>", "Reviewer comment")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "marketplace approvals process", opts.confirm);
      const body: any = {
        applicationId: opts.applicationId,
        approverEntityId: opts.approverEntityId,
        action: opts.action,
      };
      if (opts.comment) body.comment = opts.comment;
      await run(ctx, `${BASE}/processApproval`, body);
    });

  // ── applications ──────────────────────────────────────────────────────
  const applications = marketplace.command("applications").description("Connection applications");

  applications
    .command("list")
    .description("List connection applications (buyer/seller/type/status filters)")
    .option("--buyer-entity-id <id>", "Filter by buyer entity")
    .option("--seller-entity-id <id>", "Filter by seller entity")
    .addOption(
      new Option("--type <type>", "Application type").choices(["connection", "partnership", "integration", "config_change"]),
    )
    .addOption(
      new Option("--status <status>", "Application status (1=pending 2=under_review 3=approved 4=rejected 5=cancelled)")
        .choices(["1", "2", "3", "4", "5"]),
    )
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { page: { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) } };
      if (opts.buyerEntityId) body.buyerEntityId = opts.buyerEntityId;
      if (opts.sellerEntityId) body.sellerEntityId = opts.sellerEntityId;
      if (opts.type) body.applicationType = opts.type;
      if (opts.status) body.status = parseInt(opts.status, 10);
      await run(ctx, `${BASE}/listConnectionApplications`, body);
    });

  applications
    .command("by-entity")
    .description("List applications touching one entity (both sides unless --role narrows)")
    .requiredOption("--entity-id <id>", "Entity ID")
    .addOption(new Option("--role <role>", "Restrict to one side").choices(["buyer", "seller"]))
    .action(async (opts) => {
      const body: any = { entityId: opts.entityId };
      if (opts.role) body.role = opts.role;
      await run(ctx, `${BASE}/getApplicationsByEntity`, body);
    });

  return marketplace;
}
