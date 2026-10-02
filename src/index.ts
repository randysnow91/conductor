// Conductor entrypoint. Usage: node dist/index.js <daily|weekly> [--dry-run]
// Exits non-zero if any newsletter's run failed, so Render's cron alerting
// emails the operator (docs/R2_BUILD-SPEC.md §4.3).
import { runDaily } from "./daily";
import { loadEnv } from "./env";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const mode = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");

  if (mode !== "daily" && mode !== "weekly") {
    console.error("Usage: conductor <daily|weekly> [--dry-run]");
    return 2;
  }
  if (mode === "weekly") {
    console.error("[conductor] weekly pipeline not built yet (M2)");
    return 1;
  }

  const env = loadEnv();
  console.log(`[conductor] daily run for ${env.newsletters.length} newsletter(s)${dryRun ? " (dry run)" : ""}`);
  const failed = await runDaily(env, dryRun);
  console.log(`[conductor] done: ${env.newsletters.length - failed} succeeded, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

// exitCode rather than process.exit(): exiting while undici is still closing
// a connection trips a libuv assertion on Windows (exit 127 instead of 1).
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`[conductor] ${(err as Error).message}`);
    process.exitCode = 1;
  }
);
