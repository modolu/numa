# Numa — Your onchain inbox

Numa turns fragmented wallet activity, protocol updates, governance deadlines,
claims, renewals and risk events into one prioritized inbox of actions.

**Live demo:** https://proper-egret-956.convex.site (public, no sign-in)

## Problem
A wallet has state but no inbox. What needs your attention is scattered across
explorers, protocol dashboards, governance forums, docs and email, and none of
it is ranked by whether it matters to *you*.

## Solution
Numa answers three questions for one monitored wallet — *what happened, why it
matters to me, what should I do next* — and delivers the few items that matter
as a realtime inbox, a daily brief and urgent alerts. It is read-only and
advisory: no signing, no custody, no seed phrases.

## Architecture
```text
onchain adapters (ENS) ─┐
official sources (Firecrawl) ─┤→ rawEvents → normalize → relevance → priority
demo fixtures ─┘                → dedupe → canonical events → Convex → inbox
                                              ↓ (when eligible)     ↓
                                     OpenAI interpretation     briefs / alerts
                                     (strict schema, validated)  via AgentMail
```
Convex is the whole backend: database, realtime queries, mutations, Node
actions for providers, scheduler and crons, HTTP actions, and static hosting.
Priority is a deterministic weighted score; the model may explain, never
invent. Full detail: `NUMA_ARCHITECTURE.md`; build order: `IMPLEMENTATION_PLAN.md`;
public build log: `hackathon.md`.

## Sponsor stack
- **Convex** — realtime data, workflows, scheduling, HTTP, static hosting.
- **Firecrawl** — scrapes official protocol pages; Numa hashes and detects changes.
- **OpenAI** — Responses API with strict Structured Outputs to interpret changed
  sources, validated locally with a deterministic severity guardrail.
- **AgentMail** — daily briefs, urgent alerts and deadline reminders with
  idempotent delivery and a persisted history.

## Demo flow (under three minutes)
1. Open Numa — the shared demo wallet's inbox is already ranked.
2. Open the Aave-style risk item: what happened, why it matters, next step.
3. Wallets → live ENS exposure from a real onchain read; Refresh wallet.
4. Settings → official protocol sources Numa monitors and their crawl health.
5. Snooze or complete an item; watch it move in realtime.
6. Brief → today's deterministic brief and its AgentMail delivery history.

Fixture items are always labelled **DEMO DATA**; live items are labelled **LIVE**.

## Local development
```bash
npm install
npx convex dev        # provisions/links a dev deployment, writes .env.local
npm run dev           # Next.js on http://localhost:3000
```
Checks: `npm run check` (lint, typecheck, tests), `npm run build` (static
export), `npm run deploy` (backend + static site to production).

Provider configuration lives in Convex deployment env vars — see
`.env.example` for the names. Only `NEXT_PUBLIC_CONVEX_URL` reaches the browser.

## Safety / read-only model
No wallet connection, signing or transactions. Public addresses only. Crawled
pages are untrusted data: never executed, never followed as instructions, and
model output is re-validated before it can touch the inbox. Emails link only
to allow-listed official pages.

## Known limitations
- One shared hackathon demo identity (real authentication is a later milestone).
- ENS discovery covers the wallet's primary `.eth` name; Aave, governance and
  bridge items are deterministic fixtures.
- OpenAI interpretation falls back to the generic "source updated" card when
  the API is unavailable or the model output fails local validation. The
  production interpretation path has been verified live (2026-09-21).
- Delivery-status webhook is prepared and verified with signed test payloads;
  live registration depends on the provider account's permissions.
