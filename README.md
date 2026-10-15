# Conductor

Orchestrator for the newsletter pipeline. On a schedule it fetches each
newsletter's config from **EmailServer**, asks **Content Builder** to generate
an Issue, files that Issue in EmailServer as a draft, and exits. It never
generates content, never sends email, and never waits on a human — approval
happens later in EmailServer's review UI.

## How this fits the bigger picture

| Service | Role |
|---|---|
| **EmailServer** | System of record — newsletters, subscribers, templates, Issues, sending. |
| **Content Builder** | Generates an Issue's content. Stateless. |
| **Conductor** (this repo) | Orchestrates the schedule and the handoffs between the other two. No database, no server, no UI. |

Full design: [`docs/CONTENT-PIPELINE-ARCHITECTURE.md`](docs/CONTENT-PIPELINE-ARCHITECTURE.md)
(synced copy; canonical in EmailServer's repo). Build plan for this repo:
[`docs/R2_BUILD-SPEC.md`](docs/R2_BUILD-SPEC.md).

## Setup

```bash
npm install
cp .env.example .env   # fill in URLs, secret, and NEWSLETTERS
```

## Running

```bash
npm run check-env   # validate .env against the live services (read-only, prints no secrets)
npm run daily:dry   # generate content and log it, but don't file it in EmailServer
npm run daily       # full run: generate and file a draft Issue
npm run weekly:dry  # weekly from the last 7 days' sent dailies, not filed
npm run weekly      # full weekly run: file a draft weekly Issue
npm run build && npm start -- daily   # what the Render Cron Jobs run (daily / weekly)
```

Two Render Cron Job services from this repo, same build command
(`npm install && npm run build`):

| Service | Schedule (UTC) | Start command |
|---|---|---|
| daily | `45 12 * * *` (7:45 AM CDT) | `node dist/index.js daily` |
| weekly | `0 19 * * 5` (Fri 2 PM CDT) | `node dist/index.js weekly` |

Exits non-zero if any newsletter's run fails, so Render's cron alerting emails
the operator.
