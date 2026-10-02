// Validates Conductor's env config without printing any secret values.
// Usage: npm run check-env   (or `node dist/check-env.js` on Render)
//
// Live checks are read-only: Content Builder's secret is tested with an empty
// /generate body (right secret -> 400, wrong -> 401; nothing is generated),
// and each newsletter's id+key against EmailServer's GET config endpoint.
import "dotenv/config";

let failures = 0;
const pass = (msg: string) => console.log(`  PASS  ${msg}`);
const fail = (msg: string) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const warn = (msg: string) => console.log(`  WARN  ${msg}`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns the URL's origin if it's a usable base URL, else null.
function checkBaseUrl(name: string): string | null {
  const value = process.env[name];
  if (!value) {
    fail(`${name} is empty`);
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} is not a valid URL`);
    return null;
  }
  if (url.pathname !== "/") {
    fail(`${name} has a path (${url.pathname}) - use just the base URL, e.g. ${url.origin}`);
    return null;
  }
  if (url.protocol !== "https:") warn(`${name} is not https: ${url.origin}`);
  pass(`${name} is ${url.origin}`);
  return url.origin;
}

type NewsletterEntry = { id?: string; contentApiKey?: string };

function checkNewsletters(): NewsletterEntry[] {
  let entries: unknown;
  try {
    entries = JSON.parse(process.env.NEWSLETTERS ?? "");
  } catch {
    fail("NEWSLETTERS is not valid JSON");
    return [];
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    fail("NEWSLETTERS must be a non-empty JSON array");
    return [];
  }
  pass(`NEWSLETTERS has ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`);

  entries.forEach((entry: NewsletterEntry, i) => {
    for (const field of ["id", "contentApiKey"] as const) {
      const value = entry[field];
      if (!value) fail(`NEWSLETTERS[${i}].${field} is missing`);
      else if (value.includes("<")) fail(`NEWSLETTERS[${i}].${field} is still the example placeholder`);
      else if (!UUID.test(value)) fail(`NEWSLETTERS[${i}].${field} is not a UUID`);
      else pass(`NEWSLETTERS[${i}].${field} is a UUID`);
    }
  });
  return entries;
}

async function checkContentBuilder(baseUrl: string, secret: string): Promise<void> {
  try {
    // Generous timeout: Render's free tier can take a minute to wake up.
    const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(90_000) });
    if (health.ok) pass(`Content Builder is up (/health ${health.status})`);
    else fail(`Content Builder /health returned ${health.status}`);

    const res = await fetch(`${baseUrl}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-conductor-secret": secret },
      body: "{}",
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 400) pass("Content Builder accepted CONTENT_BUILDER_ACCESS_SECRET");
    else if (res.status === 401) fail("Content Builder rejected CONTENT_BUILDER_ACCESS_SECRET (401)");
    else fail(`Content Builder /generate returned unexpected status ${res.status}`);
  } catch (err) {
    fail(`Content Builder unreachable: ${(err as Error).message}`);
  }
}

async function checkEmailServer(baseUrl: string, entry: NewsletterEntry, i: number): Promise<void> {
  if (!entry.id || !entry.contentApiKey) return;
  try {
    const res = await fetch(`${baseUrl}/api/newsletters/${encodeURIComponent(entry.id)}/config`, {
      headers: { "x-content-api-key": entry.contentApiKey },
      signal: AbortSignal.timeout(90_000),
    });
    if (res.status === 401) {
      fail(`EmailServer rejected NEWSLETTERS[${i}] (401) - id and contentApiKey don't belong together`);
      return;
    }
    if (!res.ok) {
      fail(`EmailServer config for NEWSLETTERS[${i}] returned ${res.status}`);
      return;
    }
    pass(`EmailServer accepted NEWSLETTERS[${i}] id + contentApiKey`);

    // Content Builder 400s on empty topics/voice, so catch that here too.
    const config = (await res.json()) as { topics?: string; voice?: string };
    for (const field of ["topics", "voice"] as const) {
      const value = config[field]?.trim();
      if (value) pass(`  ${field}: ${JSON.stringify(value.length > 70 ? value.slice(0, 70) + "..." : value)}`);
      else fail(`  ${field} is empty on this newsletter - Content Builder will reject it`);
    }
  } catch (err) {
    fail(`EmailServer unreachable: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  console.log("Config");
  const emailServerUrl = checkBaseUrl("EMAIL_SERVER_URL");
  const contentBuilderUrl = checkBaseUrl("CONTENT_BUILDER_URL");
  const secret = process.env.CONTENT_BUILDER_ACCESS_SECRET ?? "";
  if (!secret) fail("CONTENT_BUILDER_ACCESS_SECRET is empty");
  else if (secret !== secret.trim()) fail("CONTENT_BUILDER_ACCESS_SECRET has leading/trailing whitespace");
  else pass(`CONTENT_BUILDER_ACCESS_SECRET is set (${secret.length} chars)`);
  const newsletters = checkNewsletters();

  console.log("\nLive (read-only - nothing is generated or posted)");
  if (contentBuilderUrl && secret) await checkContentBuilder(contentBuilderUrl, secret);
  if (emailServerUrl) {
    for (const [i, entry] of newsletters.entries()) await checkEmailServer(emailServerUrl, entry, i);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
