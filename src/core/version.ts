/**
 * version.ts — single source of the CLI package version (package.json "version").
 *
 * Kept in core/ (importable by both src/cli.ts and the core modules — e.g. the
 * local MCP server's serverInfo) so the version is declared exactly once.
 */

export const VERSION = "0.0.4";
