// The daily pipeline (docs/R2_BUILD-SPEC.md §3, M1): for each newsletter,
// GET config -> POST /generate -> POST /api/issues. Each newsletter succeeds
// or fails on its own (§7.1).
import type { Env } from "./env";
import { describe, fileIssue, runAll } from "./run";
import { generateIssue, getNewsletterConfig } from "./services";

// Returns the number of newsletters whose run failed.
export function runDaily(env: Env, dryRun: boolean): Promise<number> {
  return runAll("daily", env, async (newsletter, log) => {
    const started = Date.now();

    const config = await getNewsletterConfig(env, newsletter);
    log("got config from EmailServer");

    log("requesting daily Issue from Content Builder (can take several minutes)...");
    const issueJson = await generateIssue(env, { type: "daily", newsletterConfig: config });
    const { line, articles } = describe(issueJson);
    log(`Content Builder returned an Issue in ${Math.round((Date.now() - started) / 1000)}s: ${line}`);
    if (articles === 0) {
      // Not a Conductor failure (§4.3) - it still gets filed for human review.
      log("WARN no article cards in this Issue - it needs a human look before sending");
    }

    await fileIssue(env, newsletter, issueJson, dryRun, log);
  });
}
