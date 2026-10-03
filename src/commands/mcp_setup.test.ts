import { describe, expect, test } from "bun:test";
import { appendCodexToml, mergeMcpJson } from "./mcp_setup.ts";

describe("mergeMcpJson", () => {
  test("creates a fresh file with the right key", () => {
    const out = JSON.parse(mergeMcpJson(null, "mcpServers"));
    expect(out.mcpServers.hotelbyte).toEqual({ command: "hbcli", args: ["mcp", "serve"] });
  });

  test("uses servers key for vscode", () => {
    const out = JSON.parse(mergeMcpJson(null, "servers"));
    expect(out.servers.hotelbyte.command).toBe("hbcli");
  });

  test("preserves other servers", () => {
    const existing = JSON.stringify({ mcpServers: { weather: { command: "uvx", args: ["mcp-server-weather"] } } });
    const out = JSON.parse(mergeMcpJson(existing, "mcpServers"));
    expect(out.mcpServers.weather.args).toEqual(["mcp-server-weather"]);
    expect(out.mcpServers.hotelbyte.command).toBe("hbcli");
  });

  test("overwrites a stale hotelbyte entry", () => {
    const existing = JSON.stringify({ mcpServers: { hotelbyte: { command: "old" } } });
    const out = JSON.parse(mergeMcpJson(existing, "mcpServers"));
    expect(out.mcpServers.hotelbyte.command).toBe("hbcli");
  });
});

describe("appendCodexToml", () => {
  test("appends to an empty config", () => {
    const out = appendCodexToml(null)!;
    expect(out).toContain('[mcp_servers.hotelbyte]');
    expect(out).toContain('args = ["mcp", "serve"]');
  });

  test("keeps existing sections", () => {
    const out = appendCodexToml('[mcp_servers.other]\ncommand = "x"\n')!;
    expect(out).toContain("[mcp_servers.other]");
    expect(out).toContain("[mcp_servers.hotelbyte]");
  });

  test("returns null when the section already exists", () => {
    expect(appendCodexToml('[mcp_servers.hotelbyte]\ncommand = "hbcli"\n')).toBeNull();
  });
});
