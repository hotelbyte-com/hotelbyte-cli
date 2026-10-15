import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Transport fixture only: these responses do not assert live hotel inventory.
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = await req.json() as any;
    if (new URL(req.url).pathname === "/api/auth/ticket") {
      return Response.json({ code: 0, data: { ticket: "demo-test-ticket" } });
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fixture", version: "1" } } });
  },
});
afterAll(() => server.stop(true));

const cli = join(import.meta.dir, "..", "src", "cli.ts");
const marker = "shared HotelByte sandbox demo identity";
const upgradeCommands = ["hbcli auth send-code", "hbcli auth register", "hbcli mcp setup", "without --demo", "tenant.enableDemoSuppliers", "Codex/Grok/Trae", "setup preserves existing TOML entries", "hbcli auth set-credentials"];

async function run(args: string[], home: string, input = "") {
  const child = Bun.spawn([process.execPath, "run", cli, ...args], {
    env: { ...process.env, HOME: home, STAICLI_HOME: home, HOTELBYTE_ENV: "uat", HOTELBYTE_BASE_URL: `http://localhost:${server.port}` },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  child.stdin.write(input);
  child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  return { stdout, stderr, code };
}

function seedPersonalCredentials(home: string) {
  const personal = { "portal:uat": { username: "personal@example.com", ticket: "personal-ticket" } };
  writeFileSync(join(home, "credentials.json"), JSON.stringify(personal));
  return personal["portal:uat"];
}

function expectGuide(text: string) {
  expect(text).toContain(marker);
  for (const command of upgradeCommands) expect(text).toContain(command);
}

describe("demo upgrade guidance on actual CLI commands", () => {
  for (const local of [false, true]) {
    for (const demo of [false, true]) {
      it(`serve local=${local} demo=${demo} preserves JSON-RPC stdout and personal credentials`, async () => {
        const home = mkdtempSync(join(tmpdir(), "hbcli-demo-upgrade-"));
        try {
          const personal = seedPersonalCredentials(home);
          const result = await run(["mcp", "serve", ...(local ? ["--local"] : []), ...(demo ? ["--demo"] : [])], home,
            JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) + "\n");
          expect(result.code).toBe(0);
          const lines = result.stdout.trim().split("\n");
          expect(lines).toHaveLength(1);
          expect(JSON.parse(lines[0]).id).toBe(1);
          expect(result.stdout).not.toContain(marker);
          if (demo) expectGuide(result.stderr);
          else expect(result.stderr).not.toContain(marker);
          expect(JSON.parse(readFileSync(join(home, "credentials.json"), "utf8"))["portal:uat"]).toEqual(personal);
        } finally { rmSync(home, { recursive: true, force: true }); }
      });
    }
  }

  for (const json of [false, true]) {
    for (const demo of [false, true]) {
      it(`setup json=${json} demo=${demo} guides only demo users and retains config mode`, async () => {
        const home = mkdtempSync(join(tmpdir(), "hbcli-demo-setup-"));
        try {
          const personal = seedPersonalCredentials(home);
          const result = await run([...(json ? ["--json"] : []), "mcp", "setup", "cursor", ...(demo ? ["--demo"] : [])], home);
          expect(result.code).toBe(0);
          const output = json ? JSON.parse(result.stdout) : undefined;
          const text = json ? output.steps.join("\n") : result.stdout;
          if (demo) expectGuide(text);
          else expect(text).not.toContain(marker);
          if (json) expect(output.verified).toBe(true);
          const config = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
          expect(config.mcpServers.hotelbyte.args).toEqual(["mcp", "serve", ...(demo ? ["--demo"] : [])]);
          expect(JSON.parse(readFileSync(join(home, "credentials.json"), "utf8"))["portal:uat"]).toEqual(personal);
        } finally { rmSync(home, { recursive: true, force: true }); }
      });
    }
  }
});
