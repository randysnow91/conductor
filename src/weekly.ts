// The weekly pipeline (docs/R2_BUILD-SPEC.md §3, M2): for each newsletter,
// GET config -> GET the week's sent dailies -> POST /generate (weekly) ->
// POST /api/issues. EmailServer never gives a weekly a send_after, so it
// always waits for the operator's approval.
import type { Env } from "./env";
import { describe, fileIssue, runAll } from "./run";
import { generateIssue, getNewsletterConfig, getSentDailies } from "./services";

// A rolling 7 days rather than "since Monday": consecutive Friday runs tile
// exactly, so every sent daily (weekends included) lands in one weekly (§4.6).
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Returns the number of newsletters whose run failed.
export function runWeekly(env: Env, dryRun: boolean): Promise<number> {
  const since = new Date(Date.now() - WEEK_MS);

  return runAll("weekly", env, async (newsletter, log) => {
    const started = Date.now();

    const config = await getNewsletterConfig(env, newsletter);
    log("got config from EmailServer");

    const weekContent = await getSentDailies(env, newsletter, since);
    log(`got ${weekContent.length} sent daily Issue(s) since ${since.toISOString()}: ${weekContent.map((d) => d.date).join(", ") || "none"}`);
    if (weekContent.length === 0) {
      // Content Builder turns an empty week into a "quiet week" Issue - still filed.
      log("WARN no sent dailies this week - expect a quiet-week Issue");
    }

    log("requesting weekly Issue from Content Builder...");
    const issueJson = await generateIssue(env, { type: "weekly", newsletterConfig: config, weekContent });
    log(`Content Builder returned an Issue in ${Math.round((Date.now() - started) / 1000)}s: ${describe(issueJson).line}`);

    await fileIssue(env, newsletter, issueJson, dryRun, log);
  });
}
