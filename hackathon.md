# Hackathon log

- **Project:** Numa
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns fragmented wallet activity, protocol updates, governance deadlines, claims, approvals, renewals, and risk events into a prioritized inbox of onchain actions.
- **Live app:** not deployed
- **Repo:** none
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** none
- **Convex features:** schema, tables, indexes, queries, mutations, actions, Node actions, internal functions, scheduled functions, crons, realtime queries
- **Auth:** none
- **AI models:** gpt-5-mini (OpenAI Responses API, strict Structured Outputs)
- **Started:** 2026-09-19T22:57:07Z
- **Last updated:** 2026-09-20T09:48:11Z

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

## Project notes

### One-line pitch
Numa is the inbox for your onchain life.

### Demo target
A judge enters a wallet and sees the few onchain actions that matter now, with
realtime updates, source-grounded explanations, and a personalized email digest.

### Sponsor roles
- **Convex:** realtime application state and workflows.
- **Firecrawl:** official protocol-source monitoring and change detection.
- **OpenAI:** relevance/explanation/brief generation over structured verified context.
- **AgentMail:** digest, urgent alerts, and deadline reminders.

### Demo sequence
1. Enter wallet.
2. Numa discovers relevant context.
3. Prioritized inbox appears.
4. Open an Aave-style risk event.
5. Firecrawl detects an official protocol update.
6. Relevance logic matches it to wallet exposure.
7. OpenAI explains the change.
8. Convex pushes the new item into the open inbox.
9. User snoozes/completes items.
10. AgentMail sends the Numa brief.

### Guardrail
No transaction signing or autonomous execution in the hackathon MVP.
