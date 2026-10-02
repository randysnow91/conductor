// Reads and validates Conductor's env once at startup. `npm run check-env`
// (src/check-env.ts) does the same checks plus live calls, with friendlier
// per-field output - use that to diagnose; this just refuses to start on bad config.
import "dotenv/config";

export type Newsletter = { id: string; contentApiKey: string };

export type Env = {
  emailServerUrl: string;
  contentBuilderUrl: string;
  contentBuilderSecret: string;
  newsletters: Newsletter[];
};

function baseUrl(name: string, problems: string[]): string {
  const value = process.env[name];
  try {
    const url = new URL(value ?? "");
    if (url.pathname !== "/") problems.push(`${name} must be a base URL with no path`);
    return url.origin;
  } catch {
    problems.push(`${name} is missing or not a valid URL`);
    return "";
  }
}

export function loadEnv(): Env {
  const problems: string[] = [];
  const emailServerUrl = baseUrl("EMAIL_SERVER_URL", problems);
  const contentBuilderUrl = baseUrl("CONTENT_BUILDER_URL", problems);

  const contentBuilderSecret = process.env.CONTENT_BUILDER_ACCESS_SECRET?.trim() ?? "";
  if (!contentBuilderSecret) problems.push("CONTENT_BUILDER_ACCESS_SECRET is empty");

  let newsletters: Newsletter[] = [];
  try {
    const parsed: unknown = JSON.parse(process.env.NEWSLETTERS ?? "");
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error();
    newsletters = parsed.map((entry, i) => {
      if (typeof entry?.id !== "string" || !entry.id || typeof entry?.contentApiKey !== "string" || !entry.contentApiKey) {
        problems.push(`NEWSLETTERS[${i}] needs non-empty "id" and "contentApiKey" strings`);
      }
      return { id: entry?.id, contentApiKey: entry?.contentApiKey };
    });
  } catch {
    problems.push("NEWSLETTERS must be a non-empty JSON array");
  }

  if (problems.length > 0) {
    throw new Error(`Invalid configuration (run \`npm run check-env\` for details):\n  - ${problems.join("\n  - ")}`);
  }
  return { emailServerUrl, contentBuilderUrl, contentBuilderSecret, newsletters };
}
