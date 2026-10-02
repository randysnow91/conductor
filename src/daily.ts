// The daily pipeline (docs/R2_BUILD-SPEC.md §3, M1): for each newsletter,
// GET config -> POST /generate -> POST /api/issues. Each newsletter succeeds
// or fails on its own (§7.1).
import { mkdir, writeFile } from "node:fs/promises";
import type { Env, Newsletter } from "./env";
import { generateDailyIssue, getNewsletterConfig, postIssue } from "./services";

const DRY_RUN_DIR = "dry-run";

// Read-only peek at the Issue for logging - never used to change what gets posted.
type IssueSummary = { date?: string; blocks?: { kind?: string }[]; reviewerFlags?: unknown[] };

function describe(issue: IssueSummary): { line: string; articles: number } {
  const blocks = issue.blocks ?? [];
  const articles = blocks.filter((b) => b.kind === "article_card").length;
  const flags = issue.reviewerFlags?.length ?? 0;
  return {
    line: `date=${issue.date} blocks=${blocks.length} articles=${articles} reviewerFlags=${flags}`,
    articles,
  };
}

async function runOne(env: Env, newsletter: Newsletter, dryRun: boolean): Promise<void> {
  const log = (msg: string) => console.log(`[daily ${newsletter.id}] ${msg}`);
  const started = Date.now();

  const config = await getNewsletterConfig(env, newsletter);
  log("got config from EmailServer");

  log("requesting daily Issue from Content Builder (can take several minutes)...");
  const issueJson = await generateDailyIssue(env, config);
  const { line, articles } = describe(JSON.parse(issueJson) as IssueSummary);
  log(`Content Builder returned an Issue in ${Math.round((Date.now() - started) / 1000)}s: ${line}`);
  if (articles === 0) {
    // Not a Conductor failure (§4.3) - it still gets filed for human review.
    log("WARN no article cards in this Issue - it needs a human look before sending");
  }

  if (dryRun) {
    await mkdir(DRY_RUN_DIR, { recursive: true });
    const file = `${DRY_RUN_DIR}/${newsletter.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeFile(file, issueJson);
    log(`dry run - not posted to EmailServer; Issue saved to ${file}`);
    return;
  }

  const posted = await postIssue(env, newsletter, issueJson);
  log(`filed draft Issue ${posted.id} (status=${posted.status}, send_after=${posted.send_after ?? "none - manual review"})`);
}

// Returns the number of newsletters whose run failed.
export async function runDaily(env: Env, dryRun: boolean): Promise<number> {
  let failed = 0;
  for (const newsletter of env.newsletters) {
    try {
      await runOne(env, newsletter, dryRun);
    } catch (err) {
      failed++;
      console.error(`[daily ${newsletter.id}] FAILED: ${(err as Error).message}`);
    }
  }
  return failed;
}
