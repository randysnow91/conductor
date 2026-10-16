// Thin clients for the two services Conductor calls (docs/R2_BUILD-SPEC.md §6).
import type { Env, Newsletter } from "./env";
import { request } from "./http";

const EMAIL_SERVER_TIMEOUT_MS = 90 * 1000; // allows for a Render cold start
const GENERATE_TIMEOUT_MS = 20 * 60 * 1000; // Content Builder's research alone can take 8 min

export type NewsletterConfig = { topics: string; voice: string };

export async function getNewsletterConfig(env: Env, newsletter: Newsletter): Promise<NewsletterConfig> {
  const { text } = await request(
    "EmailServer GET config",
    `${env.emailServerUrl}/api/newsletters/${encodeURIComponent(newsletter.id)}/config`,
    { headers: { "x-content-api-key": newsletter.contentApiKey }, timeoutMs: EMAIL_SERVER_TIMEOUT_MS }
  );
  return JSON.parse(text) as NewsletterConfig;
}

// What Content Builder wants per sent daily - the weekly's weekContent and the
// daily's recentContent (its R2_BUILD-SPEC.md §6): an IssuePayload. EmailServer stores no `date`, so it comes from created_at -
// the daily cron runs at 12:45 UTC, the same UTC day Content Builder stamped.
export type DailyIssue = { type: "daily"; date: string; blocks: unknown };

type IssueRow = { type: "daily"; blocks: unknown; created_at: string };

export async function getSentDailies(env: Env, newsletter: Newsletter, since: Date): Promise<DailyIssue[]> {
  const query = new URLSearchParams({ type: "daily", status: "sent", since: since.toISOString() });
  const { text } = await request(
    "EmailServer GET issues",
    `${env.emailServerUrl}/api/newsletters/${encodeURIComponent(newsletter.id)}/issues?${query}`,
    { headers: { "x-content-api-key": newsletter.contentApiKey }, timeoutMs: EMAIL_SERVER_TIMEOUT_MS }
  );
  const { issues } = JSON.parse(text) as { issues: IssueRow[] };
  return issues.map((row) => ({ type: row.type, date: row.created_at.slice(0, 10), blocks: row.blocks }));
}

export type GenerateRequest =
  | { type: "daily"; newsletterConfig: NewsletterConfig; recentContent?: DailyIssue[] }
  | { type: "weekly"; newsletterConfig: NewsletterConfig; weekContent: DailyIssue[] };

// Returns the Issue as the exact JSON text Content Builder sent, so it can be
// posted to EmailServer byte-for-byte unchanged (§7.2 - Conductor is a pass-through).
export async function generateIssue(env: Env, body: GenerateRequest): Promise<string> {
  const { text } = await request("Content Builder POST /generate", `${env.contentBuilderUrl}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-conductor-secret": env.contentBuilderSecret },
    body: JSON.stringify(body),
    timeoutMs: GENERATE_TIMEOUT_MS,
  });
  return text;
}

export type PostedIssue = { id: string; status: string; send_after: string | null };

export async function postIssue(env: Env, newsletter: Newsletter, issueJson: string): Promise<PostedIssue> {
  const { text } = await request("EmailServer POST /api/issues", `${env.emailServerUrl}/api/issues`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-content-api-key": newsletter.contentApiKey },
    body: issueJson,
    timeoutMs: EMAIL_SERVER_TIMEOUT_MS,
  });
  return JSON.parse(text) as PostedIssue;
}
