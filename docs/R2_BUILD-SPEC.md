# Claude Code Build Spec — Conductor (R2)

**Status:** v1.1 — repo scaffolded (M0), M1 not started.
**Derived from:** `CONTENT-PIPELINE-ARCHITECTURE.md` (the cross-repo design —
read it first, especially §7, §8, §9, §12, §16) + the *real*, current
contracts of the other two services (§4.4 below) — not just their spec text,
since a spec and a live implementation can drift.
**Scope:** Conductor's own R2 work only. EmailServer and Content Builder each
have their **own** `R2_BUILD-SPEC.md` in their own repos — see the
architecture doc §16.5 for why this isn't one shared document.

| Version | Date | Summary |
|---------|------|---------|
| v1.0 | 2026-09-29 | First draft, written once EmailServer's M1 (Issue ingestion + review UI) was built and verified, and Content Builder's M0–M3 (daily pipeline, Reviewer, RAG) were built, verified, and deployed. Scoped around what those two services can *actually* do today, not just what the architecture doc originally described — see §4.4. |
| v1.1 | 2026-10-01 | Kickoff decisions with the operator — see §4.5: daily cron at 12:45 UTC (ready for an ~8:30 AM Central review), manual send until EmailServer's auto-send cron exists, weekly Cron Job service deferred to M2, `--dry-run` flag added to M1, explicit long timeout on `/generate`. Repo scaffolded and pushed to GitHub (`randysnow91/conductor`). |

> **How to use this document.** The architecture doc says *what* and *why*,
> across all three services. This spec says *how, with what, and in what
> order* — for Conductor specifically — the same relationship
> `V1_BUILD-SPEC.md` (in EmailServer's repo) has to the SRD. Work through the
> milestones (§8) one at a time, verifying each against its acceptance checks
> before moving on.
>
> **Implementation ownership.** Where this document shows schemas, code
> shapes, or env var names, treat them as one valid illustration of the
> intent, not a required implementation.
>
> **Launch Claude Code from this folder** (`Conductor/`), not from the
> `SubscriberEmails/` parent — architecture doc §17.

---

## 1. Build Instructions (ground rules for every session)

Same ground rules as the other two repos: explain before doing, pause to
verify locally before declaring a milestone done, don't trust one successful
run (this pipeline strings together two other services and a live web
search — plenty that can be flaky), commit/push only when asked.

### 1.1 Conductor is deliberately the smallest of the three services

No database, no persistent server, no UI. It fetches, calls, posts, and
exits. If a milestone here starts wanting to *remember* something between
runs, or render anything, that's a sign the boundary is being crossed —
that state belongs in EmailServer, not here (architecture doc §3, principle
3; §16.2).

### 1.2 Every external call can fail — that's most of what this app is

Content Builder does a live web search and can be slow or return a
zero-article fallback; a network blip can hit either service. Conductor's
whole job is handling that gracefully without a human standing by to notice
(§9 below) — treat failure handling as core scope, not a follow-up polish
task.

---

## 2. Tech Stack

- **Node.js + TypeScript**, matching the other two repos' convention.
- **No web framework.** Conductor exposes no routes and needs no server —
  Render's Cron Job service type runs a command to completion and exits
  (§3, §13). A plain script with `fetch()` calls is the whole app.
- **No database** — see §1.1.
- Same lint/format conventions as the sibling repos if a template is copied
  from one of them; otherwise Claude Code's call at scaffolding time.

---

## 3. Architecture at a Glance (Conductor's slice)

Full picture: `CONTENT-PIPELINE-ARCHITECTURE.md` §7–§9. Conductor's part —
the *only* service that calls the other two:

```
Render Cron Job (schedule A, ~6:00 AM daily)
  └─▶ run "daily" for each configured newsletter:
        GET  EmailServer  /api/newsletters/:id/config        (topics, voice)
        POST Content Builder /generate  { type: "daily", newsletterConfig }
        POST EmailServer  /api/issues   (the IssuePayload Content Builder returned)
      exits — success or failure, either way (§9)

Render Cron Job (schedule B, Friday ~2:00 PM)
  └─▶ run "weekly" for each configured newsletter:
        GET  EmailServer  /api/newsletters/:id/issues?type=daily&status=sent&since=...
        POST Content Builder /generate  { type: "weekly", newsletterConfig, weekContent }
        POST EmailServer  /api/issues
      exits
```

Two Render Cron Job **services**, one codebase, different schedule + a
command-line argument (`daily` / `weekly`) selecting which pipeline runs —
see §13.

---

## 4. Architecture Decisions Called Out

### 4.1 Two Render Cron Job services, one repo

**Decision:** rather than one cron job trying to run on two different
schedules, deploy this repo as **two** Render Cron Job services — same
build, different **schedule** and a different **start command** argument
(e.g. `node dist/index.js daily` vs `node dist/index.js weekly`).

**Why:** Render's Cron Job service type takes exactly one schedule. Two
services from one repo is simpler than one service trying to self-select
"is it Friday 2pm or 6am on some other day" from inside the script, and
keeps each run's logs and failure history (§9) separately visible in Render.

### 4.2 Newsletter list lives in an env var, not a database call

**Decision:** which newsletter(s) Conductor runs for, and each one's
`content_api_key`, is configured directly as an env var on the Cron Job
service (e.g. `NEWSLETTERS='[{"id":"...","contentApiKey":"..."}]'`) — not
fetched from EmailServer at runtime.

**Why:** At 1–2 newsletters (architecture doc §1), this is the simplest
thing that works and needs no new EmailServer endpoint ("list all
newsletters and their keys" would itself be a sensitive, unscoped route this
project has deliberately avoided elsewhere — see EmailServer's own spec
§4.3 on keeping auth mechanisms narrowly scoped). Revisit only if the
newsletter count grows enough that env-var edits become the actual
bottleneck.

### 4.3 Failure reporting rides on Render's own cron alerting — no new email path

**Decision:** on an unrecoverable failure (Content Builder unreachable or
500s, EmailServer unreachable or rejects the Issue), Conductor logs clearly
and **exits with a non-zero status code**. No Mailgun, no new "Conductor
failed" email mechanism is built here.

**Why:** Render already emails the account owner when a Cron Job run exits
non-zero — that's the "did today's run succeed?" alerting the architecture
doc (§16.2) asks for, for free, without Conductor needing its own Mailgun
credentials or a new auth mechanism to reach EmailServer's notification
path. EmailServer's *existing* operator-notification email (already built,
part of `/api/issues`) still covers the success path — "a draft is ready to
review." Revisit only if Render's own alerting proves insufficient in
practice (e.g. it's too easy to miss).

A **partial** success (Content Builder returns a zero-article/empty
generation, or one with unresolved Reviewer flags) is *not* a Conductor
failure — that Issue still posts to EmailServer, which already withholds
`send_after` for exactly this case (architecture doc §9's guardrails) so it
forces manual review instead of silently going out. Conductor exits `0` for
this case; it did its job.

### 4.4 Scoped to the daily pipeline first — weekly is real but currently blocked

**Decision:** M1 below builds and fully verifies the **daily** pipeline
only. The weekly pipeline (M2) gets built too, but can't be *end-to-end*
verified yet.

**Why:** Content Builder's own `POST /generate` currently returns `501 Not
Implemented` for `{ type: "weekly", ... }` — weekly synthesis is Content
Builder's own M5, not yet built (see `ContentBuilder/docs/R2_BUILD-SPEC.md`,
currently at M3). Building Conductor's weekly path against a contract that
doesn't exist yet risks the same kind of drift that hit EmailServer's
`issue-schema.ts` earlier in this project — the fix there was reading
Content Builder's actual code, not just the architecture doc. Here the
honest move is to build M2 against the *documented* contract (architecture
doc §8, §15 decision 2) and flag it as blocked-on-verification rather than
mark it done from one successful run once Content Builder's M5 ships.

### 4.5 Kickoff decisions (2026-10-01)

- **Daily schedule: `45 12 * * *` (UTC).** The operator is in US Central
  time and wants to review and send around **8:30 AM Central**. 12:45 UTC is
  7:45 AM CDT / 6:45 AM CST — a run of several minutes still finishes well
  before 8:30 year-round. The one-hour daylight-saving drift is accepted.
  Note EmailServer computes `send_after` as *creation time + 4 h*, not a
  fixed 10:00 AM, so the cron time also sets the auto-send deadline once
  that exists.
- **Manual send is fine for M1.** EmailServer's auto-send cron isn't built
  yet (its own spec, M1 task 5); "live" for this milestone means a draft is
  waiting each morning and the operator approves it by hand.
- **Only the AI newsletter** goes in `NEWSLETTERS` for now.
- **No weekly Cron Job service until M2.** Creating it now would either fail
  every Friday (Content Builder's weekly is `501`) or run for nothing.
- **`--dry-run` flag.** Runs config fetch + generation and logs the Issue,
  but skips `POST /api/issues` — for testing without filling the review list
  with drafts.
- **Explicit `/generate` timeout.** Node's built-in `fetch` (undici) gives
  up if response headers don't arrive within 5 minutes by default. Content
  Builder on Render's free tier (cold start + a multi-minute run) can approach
  that, so the `/generate` call sets its own generous timeout (§7.3).

---

## 5. Environment Variables

```bash
# Which newsletter(s) to run for, and their EmailServer content_api_key —
# see §4.2. Illustrative shape; Claude Code's call at build time.
NEWSLETTERS='[{"id":"<email_servers.id>","contentApiKey":"<content_api_key>"}]'

# EmailServer
EMAIL_SERVER_URL=https://<email-server-render-url>

# Content Builder
CONTENT_BUILDER_URL=https://<content-builder-render-url>
CONTENT_BUILDER_ACCESS_SECRET=<same value as Content Builder's own CONDUCTOR_ACCESS_SECRET>
```

No Supabase credentials, no Mailgun credentials — see §1.1 and §4.3 for why
neither is needed here.

---

## 6. External Contracts Conductor Calls (as they actually exist today)

Conductor exposes no routes of its own — this section is the *other* two
services' real, current contracts, confirmed against their live code (not
just the architecture doc) as of 2026-09-29.

**GET `{EMAIL_SERVER_URL}/api/newsletters/:id/config`**
*(header: `x-content-api-key`)*
- `:id` must match what the key resolves to, or `401`.
- Returns `{ topics: string, voice: string }`.

**GET `{EMAIL_SERVER_URL}/api/newsletters/:id/issues?type=daily&status=sent&since=<ISO date>`**
*(header: `x-content-api-key`)*
- For the weekly pipeline (M2): fetches the week's sent daily Issues.
- Returns `{ issues: [{ id, type, status, blocks, raw_html, created_at }] }`.

**POST `{CONTENT_BUILDER_URL}/generate`**
*(header: `x-conductor-secret`)*
- Body: `{ type: "daily" | "weekly", newsletterConfig: { topics, voice } }`
  — `topics` and `voice` must both be non-empty strings or Content Builder
  rejects with `400`.
- **Daily**: returns `200` with an `IssuePayload`
  (`{ type: "daily", date, blocks, reviewerFlags? }`) — `date` is set by
  Content Builder itself (today's date); Conductor doesn't need to supply
  one.
- **Weekly**: currently returns `501` — not implemented yet (§4.4). The
  request shape it will eventually want — almost certainly the week's
  content added to the body (architecture doc §15, decision 2, calls this
  `weekContent`) — isn't pinned in Content Builder's code yet. Don't guess
  at a field name; confirm against Content Builder's actual route when its
  M5 lands.
- A `500` here is Content Builder's own agents failing outright (rare —
  its pipeline stages already degrade gracefully internally, see its own
  spec §4.3) — treat as a real Conductor-run failure (§4.3, §9).

**POST `{EMAIL_SERVER_URL}/api/issues`**
*(header: `x-content-api-key`)*
- Body: the `IssuePayload` Content Builder returned, unchanged — Conductor
  is a pass-through here, not a transform step.
- Returns `201` with `{ id, status, send_after }` on success; `400` on a
  payload EmailServer's validator rejects (should not happen if Content
  Builder's own output is itself valid — but don't assume it can't); `401`
  on a bad/missing key.
- EmailServer sends the operator's "draft ready to review" email itself —
  Conductor does nothing further once this call succeeds.

---

## 7. Key Implementation Notes

### 7.1 One newsletter's failure shouldn't sink the others

`NEWSLETTERS` (§4.2/§5) can hold more than one entry. Loop over them, catch
and log each newsletter's failure independently, and only let the *process*
exit non-zero if at least one newsletter's run actually failed (§4.3) — one
newsletter having a bad run shouldn't hide that another one succeeded, and
vice versa.

### 7.2 Conductor is a pure pass-through for the Issue payload

Never reshape, rename, or reach into the fields of what Content Builder
returns before posting it to EmailServer (architecture doc §3, principle 2:
Conductor sequences and hands data between the other two services — it
doesn't generate content or render email). If the payload needs a fix,
that's a Content Builder or EmailServer schema conversation, not a Conductor
one.

### 7.3 Timeouts should assume Content Builder can be slow

Content Builder's own build history (`ContentBuilder/docs/R2_BUILD-SPEC.md`
v1.4) shows real production runs taking a few minutes, bounded by its own
internal time-budget logic — not the seconds a typical API call takes. Don't
set an aggressive default `fetch` timeout on the `/generate` call that would
false-positive a normal, if slow, successful run as a failure.

---

## 8. Milestones & Acceptance Criteria

### M1: Daily Pipeline

**Goals:** A scheduled run generates and files a real draft daily Issue for
at least one real newsletter, end-to-end, with no human involved until
EmailServer's review step.

**Tasks:**
1. Scaffold: TypeScript, no framework, a single entrypoint taking a
   `daily`/`weekly` argument (§3, §4.1) — this milestone only needs the
   `daily` branch implemented.
2. Read `NEWSLETTERS` from env (§4.2, §5).
3. Per newsletter: `GET` config from EmailServer → `POST /generate` (daily)
   to Content Builder → `POST /api/issues` to EmailServer (§6).
4. Failure handling per newsletter, non-zero exit on any real failure
   (§4.3, §7.1).
5. The **daily** Render Cron Job service set up from this repo (§4.1),
   schedule per §4.5. The weekly service waits for M2 (§4.5).
6. A `--dry-run` flag that skips the EmailServer post (§4.5).
7. Test by running the script by hand (not waiting for the 6 AM schedule)
   against real, deployed Content Builder and EmailServer.

**Acceptance Criteria:**
- [ ] Running the daily entrypoint by hand produces a real draft Issue
      visible in EmailServer's `/admin/issues` for the configured
      newsletter, with a `send_after` timestamp EmailServer computed itself.
- [ ] The operator receives EmailServer's existing "draft ready to review"
      email — confirming Conductor didn't need to build its own
      notification path.
- [ ] Content Builder returning a zero-article/empty generation still
      produces a filed (flagged, no-`send_after`) Issue, not a Conductor
      failure — verified by temporarily forcing that case (matches
      EmailServer's own guardrail, which is already verified on its side).
- [ ] Content Builder unreachable, or EmailServer rejecting the post,
      produces a clear log line and a non-zero exit — verified by pointing
      at a wrong URL/key temporarily.
- [ ] A second newsletter's failure doesn't prevent a first newsletter's
      success in the same run (§7.1) — verified with one real and one
      deliberately-broken entry in `NEWSLETTERS`.

---

### M2: Weekly Pipeline (built, verification blocked)

**Goals:** The weekly path is coded to the documented contract (architecture
doc §8, §15 decision 2) so it's ready the moment Content Builder's M5 ships
— not a promise to fully verify it this milestone.

**Tasks:**
1. `GET /api/newsletters/:id/issues?type=daily&status=sent&since=<start of
   week>` from EmailServer.
2. `POST /generate` (weekly) to Content Builder, including the week's
   content in the body — confirm the actual field name/shape against
   Content Builder's code once M5 exists (§4.4, §6) rather than guessing
   now.
3. `POST /api/issues` to EmailServer, same as the daily path.
4. Second Render Cron Job service, Friday ~2 PM Central schedule (§4.1) —
   created in this milestone, not M1 (§4.5).

**Acceptance Criteria:**
- [ ] Code complete and reviewed against Content Builder's actual `/generate`
      weekly contract once it exists — **not just the architecture doc's
      description of it.**
- [ ] A real end-to-end weekly run files a draft weekly Issue in EmailServer
      with no `send_after` (always manually approved, per architecture doc
      §9) — this criterion can't be checked off until Content Builder's M5
      is built; note the date it actually gets verified when it happens.
- [ ] A `both`-preference subscriber's Friday behavior (separate daily +
      weekly sends, no dedup) is EmailServer's concern, already documented
      in its own spec — not re-verified here, just confirmed not broken by
      anything Conductor does.

---

## 9. Out of Scope (for this spec)

Same boundaries as the architecture doc §14, plus:

- **Content Builder's and EmailServer's own build work** — see their own
  repos' `R2_BUILD-SPEC.md`.
- **A Conductor-owned failure-notification email** — deliberately using
  Render's own cron-failure alerting instead (§4.3).
- **Retry logic beyond "the next scheduled run tries again."** A failed run
  exits; nothing here re-queues or retries mid-run. Revisit only if Render's
  daily schedule turns out to be too infrequent a retry cadence in practice.
- **A newsletter-management UI for `NEWSLETTERS`.** Editing the env var
  directly is fine at 1–2 newsletters (§4.2) — matches EmailServer's own
  "known limitation" on `topics`/`voice` having no polished UI yet either.

---

## 10. Known Limitations & Open Questions to Revisit

- **Content Builder currently hardcodes "AI news"-shaped content**, not
  just as a default — its own spec (v1.1 changelog) flags that a real
  second, non-AI newsletter needs that generalized, not copied. EmailServer
  already has a second test newsletter ("Dog Rescue") in its database from
  earlier UI testing; running Conductor's daily pipeline against it today
  would still produce AI-news content regardless of that newsletter's real
  topic, until Content Builder's own agents are generalized. That's a
  Content Builder gap, not something to work around here.
- **Render Cron Job scheduling is UTC**, worth double-checking against
  "~6:00 AM" / "Friday ~2:00 PM" (architecture doc §7, §8) meaning local
  time for the operator, not server time, when the two Cron Job services
  are actually configured.
- **`NEWSLETTERS`' shape is a guess** (§4.2) — fine to change at build time
  if something simpler turns out to fit better; it's not depended on by
  either other service.

---

*End of Build Spec v1.1 — scaffolded, M1 not started.*
