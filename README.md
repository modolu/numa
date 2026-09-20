# Numa

**Your onchain inbox.**

Numa turns fragmented wallet activity, protocol updates, governance deadlines, claims, approvals, renewals, and risk events into a prioritized inbox of actions.

## Source of truth
- `NUMA_ARCHITECTURE.md` — technical source of truth.
- `IMPLEMENTATION_PLAN.md` — execution order for the hackathon build.
- `hackathon.md` — public, evidence-based build log (kept current with `/hackathon`).

## MVP principles
- Read-only/advisory. No signing, no custody, no seed phrases.
- Convex-first backend: persistence, queries, mutations, realtime subscriptions.
- Realtime inbox.
- Small set of high-quality event types.
- Official sources first.
- Deterministic priority and dedupe.
- Source-grounded AI explanations (later milestone).

## Stack
Next.js (App Router) · React · TypeScript · Tailwind CSS v4 · Convex · Vitest + convex-test.

## Run locally

```bash
npm install
npx convex dev        # provisions/links a dev deployment and writes .env.local
npm run dev           # Next.js on http://localhost:3000
```

Keep `npx convex dev` running in a second terminal while developing so backend
changes push and types regenerate.

Then open the app, paste an EVM wallet address, and either click **Refresh
wallet** to read live onchain sources or **Load demo events** to run the
deterministic fixtures through the same ingestion pipeline.

## Email notifications
- **Daily brief, urgent alerts, deadline reminders** (`lib/notifications/`,
  `convex/notifications.ts`, `convex/briefs.ts`): briefs are built
  deterministically from canonical events (top 5 by Numa's priority order),
  urgent alerts need an actionable event at or above the user's threshold
  (never below medium), reminders fire 24h and 1h before deadlines. Every
  attempt is persisted with a dedupe key; AgentMail delivers with an
  `Idempotency-Key`. Configure on the Convex deployment: `AGENTMAIL_API_KEY`
  (needs `message_send`), `AGENTMAIL_INBOX_ID` (sending inbox address) and
  `NUMA_DEV_RECIPIENT_EMAIL` (the single development recipient until real
  auth). Optional `AGENTMAIL_WEBHOOK_SECRET` enables the delivery-status
  webhook at `/webhooks/agentmail`; `NUMA_APP_URL` adds an "Open Numa" link.

## Live sources
- **Official protocol sources** (`lib/web/`, `convex/sources.ts`): a small
  allow-listed registry of official Aave, Arbitrum and ENS pages is scraped
  with Firecrawl (single-page `scrape`, markdown only), normalized and
  SHA-256 hashed by Numa. Only a changed hash creates a raw change record,
  and it reaches an inbox only for wallets with exposure to that protocol
  (`userProtocolSubscriptions`). Requires `FIRECRAWL_API_KEY` as a Convex
  deployment env var; without it sources show as unavailable and nothing
  else breaks. Crawls are scheduled every 15 minutes and run per source
  policy (governance 30 min, updates 3 h, docs 6 h).
- **ENS expiry** (`lib/onchain/ens.ts`): the wallet's primary `.eth` name is
  resolved through the official ENS contracts over standard Ethereum JSON-RPC
  (viem). No API key is required; set `ONCHAIN_PROVIDER_URL` as a Convex
  deployment env var to use your own RPC endpoint. Read-only: Numa never
  signs, renews or submits anything. Wallets are rescanned every 6 hours
  (`convex/crons.ts`) and on demand from the UI.

## Checks

```bash
npm run lint
npm run typecheck     # Next app + Convex functions
npm test              # unit + convex-test integration suites
npm run build         # production build
npm run check         # lint + typecheck + test
```

## Layout

```text
app/          Next.js routes: /, /inbox, /event/[id], /tasks, /brief, /wallets, /settings
components/   UI (inbox, event, wallet, tasks, settings, layout, ui)
convex/       Backend: schema, functions, ingestion pipeline, intelligence, lib
lib/          Shared vocabulary, raw-event contract, onchain adapters, formatting
tests/        Vitest suites (tests/unit, tests/convex)
```

## Identity (temporary)
Real authentication is deferred to a later milestone. `convex/lib/identity.ts`
resolves a single demo identity so one local user owns wallet and event state;
ownership checks are already enforced on every read and write, and swapping in
Convex Auth / Clerk / WorkOS is a one-file change.

## Environment
See `.env.example`. Only `NEXT_PUBLIC_CONVEX_URL` reaches the browser. Provider
secrets are added as Convex deployment environment variables when their
integration milestone begins — never with a `NEXT_PUBLIC_` prefix.
