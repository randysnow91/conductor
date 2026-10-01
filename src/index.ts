// Conductor entrypoint. Usage: node dist/index.js <daily|weekly> [--dry-run]
// M0 scaffold only - the daily pipeline itself lands in M1 (docs/R2_BUILD-SPEC.md §8).
import "dotenv/config";

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");

if (mode !== "daily" && mode !== "weekly") {
  console.error('Usage: conductor <daily|weekly> [--dry-run]');
  process.exit(2);
}

console.log(`[conductor] mode=${mode} dryRun=${dryRun} - not implemented yet`);
