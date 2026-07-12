/**
 * scripts/build-all.ts — cross-platform binary builder.
 *
 * Builds hotelbyte-cli for all supported platform/arch combinations
 * using Bun's --compile flag. Outputs to dist/.
 *
 * Targets:
 *   darwin-arm64  (Apple Silicon)
 *   darwin-x64    (Intel Mac)
 *   linux-arm64   (ARM servers)
 *   linux-x64     (Intel servers)
 *
 * Usage:
 *   bun run scripts/build-all.ts
 */

import { $ } from "bun";

const TARGETS: { target: string; name: string }[] = [
  { target: "bun-darwin-arm64", name: "hotelbyte-cli-darwin-arm64" },
  { target: "bun-darwin-x64", name: "hotelbyte-cli-darwin-x64" },
  { target: "bun-linux-arm64", name: "hotelbyte-cli-linux-arm64" },
  { target: "bun-linux-x64", name: "hotelbyte-cli-linux-x64" },
];

const OUT_DIR = "dist";

console.log("Building hotelbyte-cli for all platforms…\n");

await $`mkdir -p ${OUT_DIR}`;

let success = 0;
let failed = 0;

for (const { target, name } of TARGETS) {
  const outFile = `${OUT_DIR}/${name}`;
  console.log(`  Building ${name}…`);
  try {
    await $`bun build --compile --target=${target} --outfile=${outFile} src/cli.ts`;
    // Strip .exe for non-Windows
    console.log(`  ✓ ${name}`);
    success++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e}`);
    failed++;
  }
}

console.log(`\nDone: ${success} succeeded, ${failed} failed.`);
if (failed > 0) process.exit(1);