/** Shared guidance for the single sandbox demo identity (hotel-be#32386). */
export const DEMO_UPGRADE_HINT =
  "You are on the shared HotelByte sandbox demo identity. " +
  "For your own orders, supplier rules, markup and customers, create your own tenant: " +
  "hbcli auth send-code --email <you@company.com>, then " +
  "hbcli auth register --email <you@company.com> --password <password> --tenant-name <name> --otp-code <code>. " +
  "For static-token clients, first store your own API credentials with hbcli auth set-credentials --app-key <key> --app-secret <secret>. " +
  "Re-run hbcli mcp setup <client> without --demo. " +
  "For an existing Codex/Grok/Trae config, also remove --demo from the HotelByte MCP server arguments; setup preserves existing TOML entries. " +
  "Then ask your agent to call tenant.enableDemoSuppliers with confirm=true to enable sandbox inventory.";
