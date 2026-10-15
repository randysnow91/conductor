// Shared by the daily and weekly pipelines: per-newsletter isolation (§7.1),
// the Issue summary log line, and --dry-run's save-instead-of-post.
import { mkdir, writeFile } from "node:fs/promises";
import type { Env, Newsletter } from "./env";
import { postIssue } from "./services";

const DRY_RUN_DIR = "dry-run";

export type Mode = "daily" | "weekly";
export type Log = (msg: string) => void;

// Read-only peek at the Issue for logging - never used to change what gets posted.
type IssueSummary = { date?: string; blocks?: { kind?: string }[]; reviewerFlags?: unknown[] };

export function describe(issueJson: string): { line: string; articles: number } {
  const issue = JSON.parse(issueJson) as IssueSummary;
  const blocks = issue.blocks ?? [];
  const articles = blocks.filter((b) => b.kind === "article_card").length;
  const flags = issue.reviewerFlags?.length ?? 0;
  return {
    line: `date=${issue.date} blocks=${blocks.length} articles=${articles} reviewerFlags=${flags}`,
    articles,
  };
}

// Posts the Issue to EmailServer unchanged, or with --dry-run saves it locally instead.
export async function fileIssue(env: Env, newsletter: Newsletter, issueJson: string, dryRun: boolean, log: Log): Promise<void> {
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

// Runs one pipeline for every newsletter; returns the number that failed.
export async function runAll(
  mode: Mode,
  env: Env,
  runOne: (newsletter: Newsletter, log: Log) => Promise<void>
): Promise<number> {
  let failed = 0;
  for (const newsletter of env.newsletters) {
    try {
      await runOne(newsletter, (msg) => console.log(`[${mode} ${newsletter.id}] ${msg}`));
    } catch (err) {
      failed++;
      console.error(`[${mode} ${newsletter.id}] FAILED: ${(err as Error).message}`);
    }
  }
  return failed;
}
