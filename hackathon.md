# Hackathon log

- **Project:** Numa
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns fragmented wallet activity, protocol updates, governance deadlines, claims, approvals, renewals, and risk events into a prioritized inbox of onchain actions.
- **Live app:** https://proper-egret-956.convex.site
- **Repo:** https://github.com/modolu/numa
- **Frontend:** Convex static hosting
- **Convex deployment:** https://proper-egret-956.convex.cloud
- **Components:** @convex-dev/static-hosting
- **Convex features:** schema, tables, indexes, queries, mutations, actions, Node actions, internal functions, scheduled functions, crons, HTTP actions, realtime queries, registered component, static hosting
- **Auth:** none
- **AI models:** gpt-5-mini (OpenAI Responses API, strict Structured Outputs; production interpretation path verified live on 2026-09-21)
- **Started:** 2026-09-19T22:57:07Z
- **Last updated:** 2026-09-21T22:01:22Z

## Log

### 2026-09-19 - e9db5b2
Initialized the Numa repo skeleton: architecture doc, implementation plan,
product brief, and folder boundaries for `app/`, `components/`, `convex/`,
`lib/`, and `tests/`. Defined the full data model with 11 tables (users,
wallets, protocols, protocolSources, rawEvents, events, tasks, briefs,
userProtocolSubscriptions, notificationPreferences, notifications) and lookup
indexes such as `by_user_status` and `by_dedupe_key`. All Convex function
modules, ingestion adapters (wallet, Firecrawl, protocols), intelligence steps
(normalize, relevance, priority, summarize), jobs, and webhook boundaries
(Firecrawl, AgentMail) are empty stubs. Shared event category/severity/status
enums and an onchain adapter interface live in `lib/`. No `package.json`,
frontend, or Convex deployment yet. Convex features: schema, tables, indexes
(`convex/schema.ts`, `lib/validation/events.ts`, `lib/onchain/provider.ts`).

### 2026-09-19 - 968ecc9
Numa now runs end to end: a user pastes one EVM wallet, five deterministic demo
events flow through the real pipeline (fixture source → rawEvent → normalize →
relevance → priority → deduplicating upsert → task), and the inbox, tasks and
event detail screens update live through Convex subscriptions across browser
tabs. Read, snooze, unsnooze, dismiss and complete are enforced by a lifecycle
state machine; re-seeding reports every item as unchanged and creates no
duplicate cards. Priority is the inspectable 0.30/0.25/0.20/0.15/0.10 weighted
score with the score and factors stored on each event. Authentication is
deferred: a single demo identity is isolated in one module while ownership
checks already gate every read and write. Verified with lint, typecheck,
58 Vitest/convex-test tests, a production build and a scripted two-client
browser walkthrough. Convex features: schema, tables, indexes, queries,
mutations, internal functions, realtime queries (`convex/schema.ts`,
`convex/events.ts`, `convex/ingestion/pipeline.ts`,
`convex/intelligence/priority.ts`, `components/inbox/InboxScreen.tsx`).

### 2026-09-20 - 2e50b27
First live onchain source. Refreshing a wallet now reads its primary `.eth`
name and registration expiry from the official ENS contracts over standard
Ethereum JSON-RPC (viem, public RPC, no API key), stores the observation as a
`rawEvents` row, and runs it through the same normalize → relevance → priority
→ dedupe path as the fixtures, so a live `ens_expiry` card appears in the
inbox with a Live badge next to the demo ones. Rescans of the same state are
no-ops; a renewal updates the same logical event without touching read/snooze
state; a provider failure marks the wallet stale with a sanitized error and
leaves last-known events intact. Wallets rescan every 6 hours via cron plus a
"Refresh wallet" control with a cooldown. The adapter records whether the
wallet is the registrant, wrapped owner, or only uses the name as its primary
name. Verified live against a public wallet with a known ENS name in two
browser sessions; 87 tests, lint, typecheck and production build green.
Convex features: actions, internal functions, scheduled functions, crons
(`lib/onchain/ens.ts`, `convex/ingestion/wallet.ts`,
`convex/jobs/scanWallets.ts`, `convex/crons.ts`).

### 2026-09-20 - e89b2a2
First real offchain source. Numa now watches six official Aave, Arbitrum and
ENS pages (governance forums, blogs, docs) through Firecrawl single-page
scrapes, normalizes the markdown, hashes it with SHA-256 and keeps its own
per-source hash: the first crawl records a baseline, an unchanged page only
refreshes crawl health, and a changed page stores a bounded snapshot plus an
auditable `rawEvents` row keyed by source and content hash. A change reaches
an inbox only for wallets subscribed to that protocol; subscriptions are
derived from the wallet's own events and marked live (onchain evidence) or
demo (fixtures) so fixture exposure is never presented as wallet analysis.
The resulting `protocol_update` card is deliberately neutral (info severity,
no action required, "not yet interpreted") — no OpenAI yet. Crawls run on a
15-minute cron with per-source policies, plus a "Refresh monitored sources"
control and a source-health panel. Live verification: all six sources
scraped successfully with the deployment's Firecrawl key, repeat scrapes
reported unchanged with no duplicate records; no official page changed
during development, so the changed-content path is covered by the 34 new
mocked tests (121 total). Convex features: Node actions, scheduled
functions, crons, internal functions (`lib/web/firecrawl.ts`,
`convex/ingestion/firecrawl.ts`, `convex/sources.ts`,
`convex/subscriptions.ts`, `convex/jobs/crawlSources.ts`).

### 2026-09-20 - 4b3c19d
Semantic interpretation for changed official sources. When a monitored page
changes for a subscribed wallet, Numa now sends only a bounded excerpt plus
structured exposure facts (live vs demo, known deterministic facts) to
OpenAI through the Responses API with a strict JSON schema, no tools and no
storage, then re-validates locally: every claim must be quoted verbatim from
the source, wallet claims like "funds at risk" are rejected outright, URLs
and markup are stripped, deadlines need an explicit quoted date with an
offset, and the final severity comes from the deterministic priority engine
capped at low unless a source deadline corroborates it. The generic card is
upgraded in place with read/snooze state preserved and can never be
downgraded by a re-crawl; if the model fails, refuses, or is rejected, the
uninterpreted card stays. Model availability was probed live (gpt-5-mini),
and the production path hit a real billing 429 from the API, which verified
the fallback and bounded retries; the success path is covered by 36 new
mocked and adversarial tests (157 total) until the account has credits.
Convex features: Node actions, scheduled functions, internal functions
(`lib/ai/validation.ts`, `lib/ai/openai.ts`, `convex/ingestion/interpret.ts`,
`convex/interpretations.ts`).

### 2026-09-20 - 6eeb8e4
Email delivery through AgentMail. Numa now builds a deterministic daily
brief from canonical inbox events only (top five by the priority order,
snapshot persisted per user and local date), sends urgent alerts only for
actionable items at or above the user's threshold with a hard floor of
medium and escalation-only re-alerts, and schedules 24h/1h deadline
reminders on the Convex scheduler with stable keys, reconciliation when a
deadline moves, cancellation on complete/dismiss and a 30-day scheduling
horizon. Every attempt is persisted with a dedupe key, bounded retries and
a sanitized failure reason; the same identity is passed to AgentMail as its
Idempotency-Key and each message renders from a fixed timestamp so retries
are byte-identical. A Svix-verified webhook boundary is prepared but not
registered. Live verification: two labelled test briefs were delivered from
the configured AgentMail inbox and confirmed received, a provider-level
replay under the same key returned the identical message id with no second
email, and a demo urgent alert was delivered during regression. The
regression also caught and fixed a real bug: a 2048 ENS expiry asked the
scheduler for a reminder 21 years out. 32 new tests (189 total), all prior
browser walkthroughs green. Convex features: HTTP actions, scheduled
functions, crons, Node actions (`convex/notifications.ts`,
`convex/briefs.ts`, `convex/ingestion/mail.ts`, `convex/http.ts`,
`lib/notifications/`).

### 2026-09-21 - cf84009
Numa is public at https://proper-egret-956.convex.site, served by the
official Convex static-hosting component from the production deployment
(`convex/convex.config.ts` registers the component; `convex/http.ts` maps
Numa's page URLs to the Next.js static export and keeps the AgentMail
webhook at `/webhooks/agentmail`). The event detail route became
`/event?id=…` so the export needs no pre-generated paths. Production was
verified end to end: six official sources baselined through Firecrawl, a
live ENS read for the demo wallet, demo fixtures seeded and labelled, an
urgent alert and a labelled test brief delivered by AgentMail, and a
judge-style walkthrough in fresh desktop and mobile browsers covering
onboarding validation, realtime propagation between visitors, all lifecycle
actions, detail pages on hard reload, brief, settings and history; the built
bundle exposes only the public Convex URL and unsigned webhook calls are
refused. Quota-exhausted OpenAI errors are now non-retryable so the
uninterpreted fallback card stands without wasted attempts; OpenAI
remains unconfigured in production until the account has credits. Webhook
registration with AgentMail is pending a key with `webhook_create`.
189 tests. Convex features: registered component, static hosting, HTTP
actions (`convex/convex.config.ts`, `convex/http.ts`, `convex/staticSite.ts`,
`next.config.ts`).

### 2026-09-21 - ebee978
Live OpenAI interpretation verified in production. With `OPENAI_API_KEY`
now set on the production deployment (no `OPENAI_MODEL` override, so the
code default `gpt-5-mini` applied; a read-only model probe confirmed it is
available to the account), a controlled test exercised the existing path
end to end: the labelled dev rebaseline `sources:devForceRecrawl` on the
ENS docs source followed by one real Firecrawl crawl. The ENS documentation
page itself had not changed (the crawl returned the identical content
hash); the rebaseline only made the pipeline treat it as a change so that
one `protocol_update` card and one interpretation row were created for the
demo wallet. The scheduled `ingestion/interpret:run` made exactly one
Responses API call and completed on its first attempt in about 11 seconds
with no retry and no fallback: the strict Structured Output parsed, local
grounding and validation passed with no notes (all evidence quotes were
verbatim from the excerpt, no deadline was claimed, text limits applied),
and the deterministic priority engine remained authoritative, turning the
model's claimed `info` severity into score 0.19 / `info` without needing
the uncorroborated cap. The model judged the docs excerpt irrelevant to the
wallet's known ENS expiry (`relevant: false`), so the generic card was
correctly not upgraded, its `actionUrl` stayed the trusted source URL, no
notification was queued and the six pre-existing inbox items were
untouched. The three verification rows (event, interpretation, raw event)
were then removed from production so the public judge inbox contains no
synthetic protocol-change claim; the source keeps its real content hash.
189 tests, lint and typecheck green; no code changes. Convex features:
Node actions, scheduled functions, internal functions
(`convex/ingestion/interpret.ts`, `convex/interpretations.ts`,
`convex/sources.ts`).

## Project notes

### One-line pitch
Numa is the inbox for your onchain life.

### Demo target
A judge enters a wallet and sees the few onchain actions that matter now, with
realtime updates, source-grounded explanations, and a personalized email digest.

### Sponsor roles
- **Convex:** realtime application state, workflows, scheduling, and static hosting.
- **Firecrawl:** official protocol-source monitoring and change detection.
- **OpenAI:** structured relevance and explanation of changed official protocol sources, with deterministic validation and graceful fallback.
- **AgentMail:** daily briefs, urgent alerts, and deadline reminders.

### Demo sequence
1. Open Numa and load the demo wallet.
2. Numa surfaces prioritized onchain actions.
3. Open an Aave-style risk event and inspect what happened, why it matters, and the recommended next step.
4. Show the live ENS event discovered from Ethereum.
5. Show Firecrawl monitoring official protocol sources and Numa's change-detection pipeline.
6. Explain that relevant changes pass through the structured OpenAI interpretation layer (verified live in production), with a deterministic fallback when inference is unavailable or its output fails validation.
7. Convex pushes new and updated items into the inbox in realtime.
8. Snooze or complete an item.
9. Open the personalized Numa brief.
10. Show AgentMail delivery and notification history.

### Guardrail
No transaction signing or autonomous execution in the hackathon MVP.
