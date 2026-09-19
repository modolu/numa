# Numa — Hackathon Implementation Plan

## Objective
Prove the "onchain inbox" experience end-to-end with Convex as the realtime workflow engine, a small set of actionable event types, deterministic prioritization, source-grounded explanations, Firecrawl monitoring, and AgentMail delivery.

## Non-negotiable constraints
- `NUMA_ARCHITECTURE.md` is the technical source of truth.
- Product scope stays advisory/read-only for the hackathon.
- Convex is the primary backend; no separate API server unless a concrete blocker appears.
- One EVM wallet per user is enough for the core demo.
- Prioritize 3–5 polished event types over broad protocol support.
- Every external event must normalize into the canonical Numa event contract.
- Priority is deterministic/inspectable; LLM output does not invent urgent financial facts.
- Demo fixtures remain available so the demo never depends on unpredictable live data.

## Phase 0 — Repository + local foundation
**Goal:** a deployable Next.js + Convex shell with clean boundaries.

Deliverables:
- Next.js App Router + TypeScript + Tailwind.
- Convex configured.
- `.env.example` with only server-safe secret names.
- Architecture, product, and hackathon docs checked into repo.
- Basic routes render: `/`, `/inbox`, `/tasks`, `/brief`, `/wallets`, `/settings`, `/event/[id]`.
- Test folders and fixture conventions in place.

Definition of done:
- App starts locally.
- Convex dev deployment connects.
- No secret is exposed through `NEXT_PUBLIC_*` except the Convex URL.

## Phase 1 — Identity + wallet model
**Goal:** establish user ownership and wallet context.

Build:
- Minimal auth compatible with Convex.
- `users` and `wallets` tables + indexes.
- `addWallet`, `removeWallet`, `getWallets`.
- EVM address validation.
- One-wallet demo onboarding flow.

Definition of done:
- Authenticated user can add an EVM wallet.
- Reads/mutations enforce ownership.
- Wallet appears reactively without page refresh.

## Phase 2 — Canonical event system
**Goal:** make the inbox work before real integrations.

Build:
- `rawEvents`, `events`, `tasks` schema.
- Canonical ArcEvent types and validators.
- Deterministic dedupe key helper.
- Priority scoring helper + severity mapping.
- `upsertNormalizedEvent` mutation.
- Queries: `getInbox`, `getEvent`, `getUnreadCount`, `getTasks`.
- Mutations: `markRead`, `snoozeEvent`, `dismissEvent`, `completeTask`.

Definition of done:
- Replaying the same raw fixture creates no duplicate inbox card.
- Inbox sorts by priority/deadline.
- State transitions are visible in realtime.

## Phase 3 — Demo fixtures + polished inbox
**Goal:** lock the core product experience before external APIs.

Fixture set:
1. Aave-style health-factor risk.
2. ENS expiry.
3. Arbitrum governance deadline.
4. Bridge claim ready.
5. Protocol migration notice.

Build:
- Fixture seed mutation/action.
- Inbox card component.
- Event detail page with source/provenance.
- Empty, loading, stale, and error states.
- Clear demo-data badge when fixtures are enabled.

Definition of done:
- Judge can enter demo mode and immediately see a believable prioritized inbox.
- Read/snooze/dismiss/complete all work.

## Phase 4 — First real onchain adapter: ENS
**Goal:** prove live wallet-derived data.

Build:
- `OnchainAdapter` interface.
- ENS adapter under `lib/onchain/ens.ts`.
- Wallet scan Convex action.
- Raw event persistence before normalization.
- `ens_expiry` normalizer.

Definition of done:
- A real wallet with ENS ownership can produce or update an expiry event.
- Provider failure marks data stale instead of deleting last-known state.

## Phase 5 — Protocol subscriptions + Firecrawl
**Goal:** prove personalized offchain intelligence.

Build:
- `protocols`, `protocolSources`, `userProtocolSubscriptions`.
- Seed selected protocol sources.
- Firecrawl action + content hashing.
- Change detection and diff extraction.
- Skip unchanged pages.
- Relevance prefilter using wallet/protocol exposure.

Definition of done:
- A changed official source is detected once, stored with provenance, and only considered for users exposed to that protocol.

## Phase 6 — OpenAI structured explanation
**Goal:** transform verified source changes into concise actionable copy.

Build:
- Strict structured response schema.
- Input contains only verified source excerpt + normalized wallet context.
- Output fields: relevance, summary, why_it_matters, recommended_action, confidence.
- Deterministic validation before high/critical severity can be emitted.
- Fallback deterministic copy when the model is unavailable.

Definition of done:
- Model cannot create an event without source and wallet context.
- Invalid model output is rejected safely.

## Phase 7 — More real event types
**Goal:** reach the 3–5-event MVP breadth.

Recommended order:
1. Governance deadline.
2. ERC-20 approval warning.
3. Aave position risk.
4. One bridge claim adapter.

For each event type:
- raw fixture
- real adapter/provider
- normalizer
- dedupe strategy
- deterministic priority factors
- contract test
- UI copy

## Phase 8 — Briefs + AgentMail
**Goal:** close the product loop outside the app.

Build:
- `briefs`, `notifications`, `notificationPreferences`.
- Query today's relevant events, rank, select top 3–5.
- Generate structured morning brief.
- AgentMail action for daily digest + urgent high-severity alert.
- Persist provider message ID/status.
- Retry bounded failures.

Definition of done:
- A user receives a digest containing the same prioritized items visible in Numa.
- Duplicate digest sends are prevented by a stable `(user,date,type)` key.

## Phase 9 — Schedulers, cron, lifecycle
**Goal:** make Numa feel alive without a dedicated queue service.

Build:
- Wallet rescans.
- Protocol source recrawls.
- Event expiry.
- Snooze wake-up.
- Morning brief generation.
- Stale-source refresh.

Definition of done:
- Jobs are idempotent and safe to rerun.
- Permanent 4xx failures are not retried blindly.

## Phase 10 — Hackathon polish
**Goal:** optimize the 3-minute demo, not architecture breadth.

Ship:
- Clean onboarding.
- Fast first useful screen.
- Visible source provenance.
- Realtime event insertion during demo.
- Keyboard-friendly inbox interactions.
- Public deployment.
- `hackathon.md` with sponsor usage, architecture summary, demo script, setup steps, known limitations.
- 3-minute demo script and fallback demo path.

## Critical path
If time is tight, ship in this order:
1. Skeleton + Convex.
2. Wallet model.
3. Event model + fixture inbox.
4. ENS live adapter.
5. Firecrawl real source change.
6. OpenAI explanation.
7. AgentMail digest.
8. Add one or two more live event types.
9. Polish.

## Suggested PR/commit slices
- `chore: bootstrap next convex repo`
- `feat: add authenticated wallet model`
- `feat: add canonical event schema and inbox queries`
- `feat: seed deterministic demo events`
- `feat: add inbox state transitions`
- `feat: add ens expiry adapter`
- `feat: add protocol source subscriptions`
- `feat: add firecrawl change detection`
- `feat: add source-grounded ai explanations`
- `feat: add governance deadline events`
- `feat: add approval risk events`
- `feat: add daily briefs and agentmail delivery`
- `feat: add cron jobs and stale-state handling`
- `docs: add hackathon demo and deployment guide`
