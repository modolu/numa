# Hackathon log

- **Project:** Numa
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns fragmented wallet activity, protocol updates, governance deadlines, claims, approvals, renewals, and risk events into a prioritized inbox of onchain actions.
- **Live app:** not deployed
- **Repo:** none
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** none
- **Convex features:** schema, tables, indexes, queries, mutations, internal functions, realtime queries
- **Auth:** none
- **AI models:** none
- **Started:** 2026-09-19T22:57:07Z
- **Last updated:** 2026-09-19T23:45:47Z

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
