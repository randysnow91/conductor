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

// Returns the Issue as the exact JSON text Content Builder sent, so it can be
// posted to EmailServer byte-for-byte unchanged (§7.2 - Conductor is a pass-through).
export async function generateDailyIssue(env: Env, newsletterConfig: NewsletterConfig): Promise<string> {
  const { text } = await request("Content Builder POST /generate", `${env.contentBuilderUrl}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-conductor-secret": env.contentBuilderSecret },
    body: JSON.stringify({ type: "daily", newsletterConfig }),
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
