/**
 * commands/crm.ts — advisor CRM: clients, trips, notes, activities, workspace.
 *
 * crm clients list            List CRM clients
 * crm clients search          Search clients by keyword/stage/tags
 * crm clients get             Get one client
 * crm clients create          Create a client (write — requires --confirm)
 * crm clients update          Update a client (write — requires --confirm)
 * crm trips list              List trips
 * crm trips search            Search trips by keyword/stage/date window
 * crm trips get               Get one trip
 * crm trips create            Create a trip (write — requires --confirm)
 * crm trips update            Update a trip (write — requires --confirm)
 * crm trips set-stage         Move a trip to another stage (write — requires --confirm)
 * crm notes list              List notes
 * crm notes create            Create a note (write — requires --confirm)
 * crm activities list         List client activities
 * crm activities add          Add a timeline activity (write — requires --confirm)
 * crm workspace               Workspace summary (open/planning trips, upcoming, recent)
 *
 * Routes (verified against the live method directory, service crm/tenant and
 * crm/customer both registered from crm/service/handler.go): READS go to the
 * host-agency supervision route /api/crm/tenant/<method>; WRITES go to the
 * advisor route /api/crm/customer/<method> because TenantService overrides
 * every mutating method with a hard PermissionDenied — the tenant route is
 * read-only by design ("crm: the host-agency tenant route is read-only",
 * handler.go denyTenantWrite), so tenant-route writes can never succeed.
 *
 * Contracts: crm/protocol/crm.go (client/activity), portal.go
 * (workspace/search/notes), trip.go (trips). Lists take page:{pageNum,pageSize}
 * and return {rows,total}. Client/trip stage vocabularies: enquiry/quoted/won
 * and enquiry/planning/quoted/booked/traveling/completed/cancelled (crm/domain).
 *
 * Write confirmation follows the `catalogs` guardrail: known writes refuse to
 * execute without an explicit --confirm.
 */

import { Command, Option } from "commander";
import { run, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by every mutating crm subcommand (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

const TENANT = "/api/crm/tenant";
const CUSTOMER = "/api/crm/customer";

/** page:{pageNum,pageSize} contract shared by all crm lists (protocol portal.go). */
function page(opts: { pageNum: string; pageSize: string }): { page: { pageNum: number; pageSize: number } } {
  return { page: { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) } };
}

/** Split a comma-separated flag into a trimmed, non-empty array (catalogs.ts habit). */
function csv(value: string | undefined): string[] | undefined {
  const items = value?.split(",").map((s: string) => s.trim()).filter(Boolean);
  return items?.length ? items : undefined;
}

export function createCrmCommand(ctx: Ctx): Command {
  const crm = new Command("crm").description("Advisor CRM: clients, trips, notes, activities");

  // ── clients ───────────────────────────────────────────────────────────
  const clients = crm.command("clients").description("CRM client book");

  clients
    .command("list")
    .description("List clients (stage/tag/archive filters, recent-contact window)")
    .addOption(new Option("--stage <stage>", "Client stage filter").choices(["enquiry", "quoted", "won"]))
    .option("--tags <tags>", "Comma-separated tags (any-of, server-side)")
    .option("--archived", "Include archived clients", false)
    .option("--contacted-within-days <n>", "Only clients with operator activity in the last N days")
    .option("--not-contacted-within-days <n>", "Only clients silent for more than N days (or never contacted)")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = page(opts);
      if (opts.stage) body.stage = opts.stage;
      const tags = csv(opts.tags);
      if (tags) body.tags = tags;
      if (opts.archived) body.archived = true;
      if (opts.contactedWithinDays) body.contactedWithinDays = parseInt(opts.contactedWithinDays, 10);
      if (opts.notContactedWithinDays) body.notContactedWithinDays = parseInt(opts.notContactedWithinDays, 10);
      await run(ctx, `${TENANT}/listClients`, body);
    });

  clients
    .command("search")
    .description("Search clients by keyword (name/email/phone substring), stage or tags")
    .option("--keyword <text>", "Display name / email / phone substring")
    .addOption(new Option("--stage <stage>", "Client stage filter").choices(["enquiry", "quoted", "won"]))
    .option("--tags <tags>", "Comma-separated tags (any-of, server-side)")
    .option("--archived", "Include archived clients", false)
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = page(opts);
      if (opts.keyword) body.keyword = opts.keyword;
      if (opts.stage) body.stage = opts.stage;
      const tags = csv(opts.tags);
      if (tags) body.tags = tags;
      if (opts.archived) body.archived = true;
      await run(ctx, `${TENANT}/searchClients`, body);
    });

  clients
    .command("get")
    .description("Get one client by ID")
    .requiredOption("--id <id>", "Client ID")
    .action(async (opts) => {
      await run(ctx, `${TENANT}/getClient`, { id: opts.id });
    });

  clients
    .command("create")
    .description("Create a client (write operation — requires --confirm)")
    .requiredOption("--display-name <name>", "Client display name")
    .option("--email <email>", "Client email")
    .option("--phone <phone>", "Client phone")
    .option("--nationality <code>", "Nationality")
    .option("--birthday <date>", "Birthday (YYYY-MM-DD)")
    .option("--social-json <json>", "Social profiles JSON string")
    .option("--preferences <text>", "Free-text preferences")
    .option("--tags <tags>", "Comma-separated tags")
    .addOption(new Option("--stage <stage>", "Initial stage (default enquiry)").choices(["enquiry", "quoted", "won"]))
    .option("--notes <text>", "Free-text notes")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "crm clients create", opts.confirm);
      const body: any = { displayName: opts.displayName };
      if (opts.email) body.email = opts.email;
      if (opts.phone) body.phone = opts.phone;
      if (opts.nationality) body.nationality = opts.nationality;
      if (opts.birthday) body.birthday = opts.birthday;
      if (opts.socialJson) body.socialJson = opts.socialJson;
      if (opts.preferences) body.preferences = opts.preferences;
      const tags = csv(opts.tags);
      if (tags) body.tags = tags;
      if (opts.stage) body.stage = opts.stage;
      if (opts.notes) body.notes = opts.notes;
      await run(ctx, `${CUSTOMER}/createClient`, body);
    });

  clients
    .command("update")
    .description("Update a client (write operation — requires --confirm)")
    .requiredOption("--id <id>", "Client ID")
    .option("--display-name <name>", "New display name")
    .option("--email <email>", "New email")
    .option("--phone <phone>", "New phone")
    .option("--nationality <code>", "New nationality")
    .option("--birthday <date>", "New birthday (YYYY-MM-DD)")
    .option("--social-json <json>", "Social profiles JSON string")
    .option("--preferences <text>", "Free-text preferences")
    .option("--tags <tags>", "Comma-separated tags (replaces the set)")
    .addOption(new Option("--stage <stage>", "New stage").choices(["enquiry", "quoted", "won"]))
    .option("--notes <text>", "Free-text notes")
    .option("--archive", "Archive the client", false)
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "crm clients update", opts.confirm);
      const body: any = { id: opts.id };
      if (opts.displayName) body.displayName = opts.displayName;
      if (opts.email) body.email = opts.email;
      if (opts.phone) body.phone = opts.phone;
      if (opts.nationality) body.nationality = opts.nationality;
      if (opts.birthday) body.birthday = opts.birthday;
      if (opts.socialJson) body.socialJson = opts.socialJson;
      if (opts.preferences) body.preferences = opts.preferences;
      const tags = csv(opts.tags);
      if (tags) body.tags = tags;
      if (opts.stage) body.stage = opts.stage;
      if (opts.notes) body.notes = opts.notes;
      if (opts.archive) body.archive = true;
      await run(ctx, `${CUSTOMER}/updateClient`, body);
    });

  // ── trips ─────────────────────────────────────────────────────────────
  const trips = crm.command("trips").description("Client trips");

  trips
    .command("list")
    .description("List trips (client/stage filters; archived hidden unless included)")
    .option("--client-id <id>", "Filter by client")
    .addOption(
      new Option("--stage <stage>", "Trip stage filter").choices([
        "enquiry", "planning", "quoted", "booked", "traveling", "completed", "cancelled",
      ]),
    )
    .option("--include-archived", "Include archived trips", false)
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = page(opts);
      if (opts.clientId) body.clientId = opts.clientId;
      if (opts.stage) body.stage = opts.stage;
      if (opts.includeArchived) body.includeArchived = true;
      await run(ctx, `${TENANT}/listTrips`, body);
    });

  trips
    .command("search")
    .description("Search trips by keyword (title/client/destination), stage or date window")
    .option("--keyword <text>", "Title substring / client name substring / destination exact")
    .addOption(
      new Option("--stage <stage>", "Trip stage filter").choices([
        "enquiry", "planning", "quoted", "booked", "traveling", "completed", "cancelled",
      ]),
    )
    .option("--date-from <date>", "Date window start (YYYY-MM-DD, inclusive)")
    .option("--date-to <date>", "Date window end (YYYY-MM-DD, inclusive)")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = page(opts);
      if (opts.keyword) body.keyword = opts.keyword;
      if (opts.stage) body.stage = opts.stage;
      if (opts.dateFrom || opts.dateTo) {
        body.dateWindow = { ...(opts.dateFrom ? { start: opts.dateFrom } : {}), ...(opts.dateTo ? { end: opts.dateTo } : {}) };
      }
      await run(ctx, `${TENANT}/searchTrips`, body);
    });

  trips
    .command("get")
    .description("Get one trip by ID (includes ordered segments)")
    .requiredOption("--id <id>", "Trip ID")
    .action(async (opts) => {
      await run(ctx, `${TENANT}/getTrip`, { id: opts.id });
    });

  trips
    .command("create")
    .description("Create a trip (write operation — requires --confirm)")
    .requiredOption("--client-id <id>", "Owning client ID")
    .option("--title <text>", "Trip title")
    .option("--destinations <list>", "Comma-separated destinations")
    .option("--planned-check-in <date>", "Planned check-in (YYYY-MM-DD)")
    .option("--planned-check-out <date>", "Planned check-out (YYYY-MM-DD)")
    .option("--adults <n>", "Adult travellers", "0")
    .option("--children <n>", "Child travellers", "0")
    .option("--budget-amount <amount>", "Budget as decimal string (pass together with --budget-currency)")
    .option("--budget-currency <code>", "Budget ISO-4217 currency")
    .option("--notes <text>", "Free-text notes")
    .addOption(
      new Option("--stage <stage>", "Initial stage (default enquiry)").choices([
        "enquiry", "planning", "quoted", "booked", "traveling", "completed", "cancelled",
      ]),
    )
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "crm trips create", opts.confirm);
      const body: any = { clientId: opts.clientId };
      if (opts.title) body.title = opts.title;
      const destinations = csv(opts.destinations);
      if (destinations) body.destinations = destinations;
      if (opts.plannedCheckIn) body.plannedCheckIn = opts.plannedCheckIn;
      if (opts.plannedCheckOut) body.plannedCheckOut = opts.plannedCheckOut;
      if (opts.adults !== "0") body.adults = parseInt(opts.adults, 10);
      if (opts.children !== "0") body.children = parseInt(opts.children, 10);
      if (opts.budgetAmount) body.budgetAmount = opts.budgetAmount;
      if (opts.budgetCurrency) body.budgetCurrency = opts.budgetCurrency;
      if (opts.notes) body.notes = opts.notes;
      if (opts.stage) body.stage = opts.stage;
      await run(ctx, `${CUSTOMER}/createTrip`, body);
    });

  trips
    .command("update")
    .description("Update a trip (write operation — requires --confirm)")
    .requiredOption("--id <id>", "Trip ID")
    .option("--title <text>", "New title")
    .option("--destinations <list>", "Comma-separated destinations (replaces the set)")
    .option("--planned-check-in <date>", "Planned check-in (YYYY-MM-DD)")
    .option("--planned-check-out <date>", "Planned check-out (YYYY-MM-DD)")
    .option("--adults <n>", "Adult travellers")
    .option("--children <n>", "Child travellers")
    .option("--budget-amount <amount>", "Budget as decimal string")
    .option("--budget-currency <code>", "Budget ISO-4217 currency")
    .option("--notes <text>", "Free-text notes")
    .option("--archive", "Archive the trip", false)
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "crm trips update", opts.confirm);
      const body: any = { id: opts.id };
      if (opts.title) body.title = opts.title;
      const destinations = csv(opts.destinations);
      if (destinations) body.destinations = destinations;
      if (opts.plannedCheckIn) body.plannedCheckIn = opts.plannedCheckIn;
      if (opts.plannedCheckOut) body.plannedCheckOut = opts.plannedCheckOut;
      if (opts.adults !== undefined) body.adults = parseInt(opts.adults, 10);
      if (opts.children !== undefined) body.children = parseInt(opts.children, 10);
      if (opts.budgetAmount) body.budgetAmount = opts.budgetAmount;
      if (opts.budgetCurrency) body.budgetCurrency = opts.budgetCurrency;
      if (opts.notes) body.notes = opts.notes;
      if (opts.archive) body.archive = true;
      await run(ctx, `${CUSTOMER}/updateTrip`, body);
    });

  trips
    .command("set-stage")
    .description("Move a trip to another stage (write operation — requires --confirm; the only stage-changing action)")
    .requiredOption("--id <id>", "Trip ID")
    .addOption(
      new Option("--stage <stage>", "Target stage").choices([
        "enquiry", "planning", "quoted", "booked", "traveling", "completed", "cancelled",
      ]).makeOptionMandatory(),
    )
    .option("--reopen", "Explicit reopen from a terminal stage (completed/cancelled)", false)
    .option("--note <text>", "Advisor comment recorded on the timeline")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "crm trips set-stage", opts.confirm);
      const body: any = { id: opts.id, stage: opts.stage };
      if (opts.reopen) body.reopen = true;
      if (opts.note) body.note = opts.note;
      await run(ctx, `${CUSTOMER}/setTripStage`, body);
    });

  // ── notes ─────────────────────────────────────────────────────────────
  const notes = crm.command("notes").description("Client/trip notes and reminders");

  notes
    .command("list")
    .description("List notes (optionally narrowed to one client or trip, by due window or done state)")
    .option("--client-id <id>", "Narrow to one client")
    .option("--trip-id <id>", "Narrow to one trip")
    .option("--due-from <unix>", "Due window start (unix seconds)")
    .option("--due-to <unix>", "Due window end (unix seconds)")
    .addOption(new Option("--done <bool>", "Filter by done state (omit for all)").choices(["true", "false"]))
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = page(opts);
      if (opts.clientId) body.clientId = opts.clientId;
      if (opts.tripId) body.tripId = opts.tripId;
      if (opts.dueFrom || opts.dueTo) {
        body.dueWindow = { ...(opts.dueFrom ? { from: parseInt(opts.dueFrom, 10) } : {}), ...(opts.dueTo ? { to: parseInt(opts.dueTo, 10) } : {}) };
      }
      if (opts.done !== undefined) body.done = opts.done === "true";
      await run(ctx, `${TENANT}/listNotes`, body);
    });

  notes
    .command("create")
    .description("Create a note (write operation — requires --confirm)")
    .requiredOption("--title <text>", "Note title")
    .requiredOption("--body <text>", "Note body")
    .option("--client-id <id>", "Associate with a client")
    .option("--trip-id <id>", "Associate with a trip")
    .option("--due-time <rfc3339>", "Due time (RFC3339; omit for no deadline)")
    .option("--pinned", "Pin the note", false)
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "crm notes create", opts.confirm);
      const body: any = { title: opts.title, body: opts.body };
      if (opts.clientId) body.clientId = opts.clientId;
      if (opts.tripId) body.tripId = opts.tripId;
      if (opts.dueTime) body.dueTime = opts.dueTime;
      if (opts.pinned) body.pinned = true;
      await run(ctx, `${CUSTOMER}/createNote`, body);
    });

  // ── activities ────────────────────────────────────────────────────────
  const activities = crm.command("activities").description("Client timeline activities");

  activities
    .command("list")
    .description("List a client's timeline activities")
    .requiredOption("--client-id <id>", "Client ID")
    .option("--trip-id <id>", "Narrow to one trip")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { clientId: opts.clientId, ...page(opts) };
      if (opts.tripId) body.tripId = opts.tripId;
      await run(ctx, `${TENANT}/listActivities`, body);
    });

  activities
    .command("add")
    .description("Append a timeline activity for a client (write operation — requires --confirm)")
    .requiredOption("--client-id <id>", "Client ID")
    .requiredOption("--content <text>", "Activity content")
    .option("--trip-id <id>", "Also attach to a trip")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "crm activities add", opts.confirm);
      const body: any = { clientId: opts.clientId, content: opts.content };
      if (opts.tripId) body.tripId = opts.tripId;
      await run(ctx, `${CUSTOMER}/addActivity`, body);
    });

  // ── workspace ─────────────────────────────────────────────────────────
  crm
    .command("workspace")
    .description("Workspace summary: open/planning trip counts, upcoming trips, recent activities")
    .option("--from <date>", "Upcoming-trips window start (YYYY-MM-DD)")
    .option("--to <date>", "Upcoming-trips window end (YYYY-MM-DD)")
    .action(async (opts) => {
      const body: any = {};
      if (opts.from) body.from = opts.from;
      if (opts.to) body.to = opts.to;
      await run(ctx, `${TENANT}/getWorkspaceSummary`, body);
    });

  return crm;
}
