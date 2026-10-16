// The daily pipeline (docs/R2_BUILD-SPEC.md §3, M1): for each newsletter,
// GET config -> GET the last 7 days' sent dailies -> POST /generate ->
// POST /api/issues. Each newsletter succeeds or fails on its own (§7.1).
import { describe, fileIssue, runAll, WEEK_MS, type Log } from "./run";
import { generateIssue, getNewsletterConfig, getSentDailies, type DailyIssue } from "./services";
import type { Env, Newsletter } from "./env";

// The recent sent dailies, so Content Builder doesn't repeat a story readers
// already got (§4.7). Best effort: a failed fetch logs a WARN and returns
// undefined, and the daily goes out without the check rather than not at all.
async function getRecentContent(env: Env, newsletter: Newsletter, log: Log): Promise<DailyIssue[] | undefined> {
  const since = new Date(Date.now() - WEEK_MS);
  try {
    const recent = await getSentDailies(env, newsletter, since);
    log(`got ${recent.length} sent daily Issue(s) since ${since.toISOString()} to avoid repeating`);
    return recent;
  } catch (err) {
    log(`WARN couldn't fetch recent dailies, generating without the repeat check: ${(err as Error).message}`);
    return undefined;
  }
}

// Returns the number of newsletters whose run failed.
export function runDaily(env: Env, dryRun: boolean): Promise<number> {
  return runAll("daily", env, async (newsletter, log) => {
    const started = Date.now();

    const config = await getNewsletterConfig(env, newsletter);
    log("got config from EmailServer");

    const recentContent = await getRecentContent(env, newsletter, log);

    log("requesting daily Issue from Content Builder (can take several minutes)...");
    const issueJson = await generateIssue(env, { type: "daily", newsletterConfig: config, recentContent });
    const { line, articles } = describe(issueJson);
    log(`Content Builder returned an Issue in ${Math.round((Date.now() - started) / 1000)}s: ${line}`);
    if (articles === 0) {
      // Not a Conductor failure (§4.3) - it still gets filed for human review.
      log("WARN no article cards in this Issue - it needs a human look before sending");
    }

    await fileIssue(env, newsletter, issueJson, dryRun, log);
  });
}
