# NUMA — NUMA_ARCHITECTURE.md

> **Your onchain inbox.**
>
> Numa is a consumer Web3 application that turns fragmented wallet activity, protocol updates, governance deadlines, claims, approvals, renewals, risk events, and other onchain obligations into a single prioritized inbox of actions.

---

# 0. Executive Summary

Crypto wallets have state, but they do not have an inbox.

A user may have assets across Ethereum, Base, Arbitrum and other networks; positions in lending protocols; bridge withdrawals waiting to be claimed; ENS names expiring; governance proposals closing; token approvals left open; protocol migrations announced offchain; and rewards or positions approaching deadlines.

Today, that information is fragmented across:

- wallets;
- block explorers;
- protocol dashboards;
- governance forums;
- Discord;
- X;
- email;
- documentation;
- bridge interfaces;
- portfolio trackers.

Numa creates a single action layer above that fragmentation.

The product answers three questions:

> **What happened?**

> **Why does it matter to me?**

> **What should I do next?**

Numa is not a portfolio tracker, block explorer, news feed, trading terminal, or wallet replacement.

It is:

> **the inbox and task manager for a user's onchain life.**

The MVP architecture is intentionally event-driven and serverless-first:

```text
Wallet + Protocol Sources
          │
          ▼
     INGESTION LAYER
          │
          ▼
      NORMALIZATION
          │
          ▼
   RELEVANCE ENGINE
          │
          ▼
    PRIORITY ENGINE
          │
          ▼
        CONVEX
          │
    ┌─────┼─────────┐
    ▼     ▼         ▼
  Inbox  Tasks    Briefs
                    │
                    ▼
                AgentMail
```

The hackathon version focuses on **understanding and prioritization**, not transaction execution.

---

# 1. Product Thesis

The Web3 user experience currently optimizes heavily for:

```text
balances
charts
transactions
protocol access
```

but poorly for:

```text
attention
deadlines
obligations
follow-ups
personal relevance
```

A block explorer can show that an event happened.

A portfolio tracker can show what a wallet owns.

A news platform can show what happened in crypto.

Numa answers the more useful question:

> **Which events in the onchain ecosystem require this specific user's attention?**

That difference drives the entire architecture.

Numa therefore treats Web3 activity as an **event-to-action pipeline**, not merely a data-display problem.

---

# 2. Product Principles

## 2.1 Actionability over information density

Every surfaced inbox item must ideally produce one of:

```text
claim
renew
vote
review
revoke
migrate
withdraw
monitor
dismiss
```

If an event cannot explain why the user should care, it should probably not be in the primary inbox.

---

## 2.2 Personal relevance before global importance

An enormous protocol announcement may be irrelevant to a user.

A small ENS expiration may be critical.

Priority therefore depends on:

```text
global severity
×
wallet exposure
×
deadline proximity
×
required user action
```

---

## 2.3 Official sources first

Offchain protocol intelligence should prioritize:

1. official protocol documentation;
2. official governance sites;
3. official blogs/changelogs;
4. verified project announcements.

Numa should preserve source URLs and extraction timestamps.

---

## 2.4 Explain before acting

Every action card should answer:

```text
what changed?
why does it matter?
what should I do?
when should I do it?
where did this information come from?
```

---

## 2.5 No hidden transaction execution in the MVP

Numa does not need custody or transaction signing to prove the product.

For the hackathon:

```text
ARC_MODE=ADVISORY
```

The app may deep-link a user to an official protocol action page, but it does not autonomously sign or submit transactions.

---

## 2.6 Idempotency everywhere

The same onchain event or crawled announcement may be discovered more than once.

Numa must deduplicate before producing duplicate inbox items.

---

# 3. User Experience

The primary user flow is:

```text
Connect / enter wallet
        ↓
Discover wallet context
        ↓
Subscribe to relevant sources
        ↓
Create actionable inbox
        ↓
User reads / snoozes / completes
        ↓
Numa monitors for changes
        ↓
New relevant event appears live
        ↓
Daily or urgent email alert
```

Example home screen:

```text
NUMA

Good morning.

3 things need your attention.


HIGH
Aave health factor is 1.31
Review collateral or debt

MEDIUM
Arbitrum proposal closes in 7h
Review and vote

LOW
modolu.eth expires in 12 days
Renew domain
```

---

# 4. Core Product Surfaces

## 4.1 Inbox

The inbox is the canonical list of relevant events.

Supported states:

```text
unread
read
snoozed
completed
dismissed
expired
```

Supported priority:

```text
critical
high
medium
low
info
```

Supported classes:

```text
action
warning
deadline
update
opportunity
security
governance
```

---

## 4.2 Tasks

Some inbox items create explicit tasks.

Examples:

```text
Claim bridge withdrawal
Renew ENS
Review health factor
Vote on proposal
Revoke approval
Migrate protocol position
```

Tasks can have:

```text
deadline
reminder
snooze_until
completion_state
source_event
recommended_action_url
```

---

## 4.3 Brief

Numa produces a personalized digest.

Example:

```text
YOUR NUMA BRIEF

3 things matter today.

1. Aave health factor dropped from 1.53 to 1.31.
2. Arbitrum Proposal 441 closes tonight.
3. modolu.eth expires in 12 days.

Everything else:
No action needed.
```

The brief should be generated from already-normalized Numa events, not by giving an LLM unrestricted access to raw wallet data.

---

## 4.4 Event Detail

Every event detail page should expose:

```text
title
priority
status
wallet
chain
protocol
what happened
why it matters
recommended next step
deadline
source
detected_at
updated_at
```

Where applicable:

```text
previous value
current value
wallet exposure
related transaction
related contract
official action URL
```

---

# 5. System Context

```text
                         ┌──────────────────────┐
                         │      NUMA CLIENT      │
                         │ Next.js / React UI   │
                         └──────────┬───────────┘
                                    │ reactive queries
                                    ▼
                         ┌──────────────────────┐
                         │       CONVEX         │
                         │                      │
                         │ DB                   │
                         │ Queries              │
                         │ Mutations            │
                         │ Actions              │
                         │ Scheduler / Cron     │
                         │ HTTP Actions         │
                         └───────┬─────┬────────┘
                                 │     │
                    ┌────────────┘     └────────────┐
                    ▼                               ▼
         ┌─────────────────────┐        ┌─────────────────────┐
         │  ONCHAIN PROVIDERS  │        │     FIRECRAWL       │
         │                     │        │                     │
         │ RPC / indexing APIs │        │ docs / blogs        │
         │ ENS / governance    │        │ governance pages    │
         └──────────┬──────────┘        │ changelogs          │
                    │                   └──────────┬──────────┘
                    │                              │
                    └──────────────┬───────────────┘
                                   ▼
                       ┌──────────────────────┐
                       │ NORMALIZATION LAYER  │
                       └──────────┬───────────┘
                                  ▼
                       ┌──────────────────────┐
                       │ RELEVANCE + PRIORITY │
                       └──────────┬───────────┘
                                  │
                            ┌─────┴──────┐
                            ▼            ▼
                  ┌────────────────┐ ┌────────────────┐
                  │    OPENAI      │ │   AGENTMAIL    │
                  │ explanation    │ │ digest/alerts  │
                  └────────────────┘ └────────────────┘
```

---

# 6. Technology Choices

## Frontend

Recommended:

```text
Next.js
React
TypeScript
Tailwind CSS
Convex React client
```

Reasons:

- fast iteration;
- excellent compatibility with Convex;
- straightforward deployment;
- easy realtime UI;
- strong ecosystem for wallet tooling.

Optional:

```text
wagmi
viem
RainbowKit
```

Only if wallet connection is required.

For the MVP, read-only wallet entry is enough.

---

## Backend

Use Convex as the primary backend.

Do not introduce a separate Express/FastAPI server unless there is a concrete need.

Convex handles:

```text
application database
reactive queries
transactional mutations
external API actions
scheduled jobs
cron jobs
HTTP/webhook endpoints
```

The architectural objective is to make Convex central rather than decorative.

---

# 7. Convex Design

Recommended backend layout:

```text
convex/
│
├── schema.ts
│
├── users.ts
├── wallets.ts
├── protocols.ts
├── sources.ts
├── rawEvents.ts
├── events.ts
├── tasks.ts
├── briefs.ts
├── subscriptions.ts
├── notifications.ts
│
├── ingestion/
│   ├── wallet.ts
│   ├── protocols.ts
│   └── firecrawl.ts
│
├── intelligence/
│   ├── normalize.ts
│   ├── relevance.ts
│   ├── priority.ts
│   └── summarize.ts
│
├── jobs/
│   ├── scanWallets.ts
│   ├── crawlSources.ts
│   ├── generateBriefs.ts
│   └── expireEvents.ts
│
├── webhooks/
│   ├── firecrawl.ts
│   └── agentmail.ts
│
└── crons.ts
```

---

# 8. Convex Function Boundaries

Use the correct primitive for each job.

## Queries

Read-only, reactive client data:

```text
getInbox
getEvent
getTasks
getWallets
getBrief
getUnreadCount
getPreferences
```

---

## Mutations

Transactional state updates:

```text
addWallet
markRead
snoozeEvent
completeTask
dismissEvent
setPreferences
upsertNormalizedEvent
```

---

## Actions

External calls:

```text
fetchWalletActivity
crawlProtocolSource
classifyWithOpenAI
sendDigestViaAgentMail
```

Actions should stay small.

Application state should be persisted via mutations.

---

## Scheduled Functions

Use for:

```text
deadline reminders
snooze wake-ups
delayed rechecks
brief delivery
event expiration
```

---

## Cron Jobs

Use for recurring:

```text
wallet rescans
protocol-source recrawls
morning brief generation
stale-source refresh
```

---

# 9. Data Model

## users

```text
_id
identity_subject
email
display_name
timezone
created_at
```

---

## wallets

```text
_id
user_id
address
chain_family
label
is_primary
created_at
last_scanned_at
```

Indexes:

```text
by_user
by_address
```

---

## protocols

```text
_id
slug
name
category
official_domain
icon_url
supported_chains[]
```

---

## protocolSources

```text
_id
protocol_id
source_type
url
crawl_policy
last_crawled_at
content_hash
is_active
```

`source_type`:

```text
docs
blog
governance
changelog
status
announcement
```

---

## rawEvents

Stores source-specific discovery before normalization.

```text
_id
source
source_event_id
wallet_id?
protocol_id?
chain_id?
payload
observed_at
content_hash
processing_status
```

This table is useful for:

- replay;
- debugging;
- auditability;
- deduplication.

---

## events

Canonical Numa event.

```text
_id

dedupe_key

user_id
wallet_id?

protocol_id?
chain_id?

event_type
category
severity

title
summary
why_it_matters
recommended_action

action_url?

deadline?
occurred_at?
detected_at
updated_at

status
requires_action

source_type
source_url?
source_ref?

confidence

metadata
```

---

## tasks

```text
_id
user_id
event_id

title
status

due_at?
snooze_until?

completed_at?
created_at
```

---

## briefs

```text
_id
user_id
period
generated_at

headline
summary

event_ids[]
sent_via_email
```

---

## userProtocolSubscriptions

Derived from wallet interactions.

```text
_id
user_id
wallet_id
protocol_id
first_seen_at
last_seen_at
confidence
```

This table drives personalization of Firecrawl content.

---

## notificationPreferences

```text
user_id

email_digest_enabled
urgent_email_enabled

digest_time
timezone

minimum_email_severity
```

---

# 10. Canonical Event Contract

Every source is converted into a canonical event.

```ts
type ArcEvent = {
  dedupeKey: string;

  userId: Id<"users">;
  walletId?: Id<"wallets">;

  protocolId?: Id<"protocols">;
  chainId?: number;

  eventType: string;

  category:
    | "action"
    | "warning"
    | "deadline"
    | "update"
    | "opportunity"
    | "security"
    | "governance";

  severity:
    | "critical"
    | "high"
    | "medium"
    | "low"
    | "info";

  title: string;
  summary: string;
  whyItMatters: string;

  recommendedAction?: string;
  actionUrl?: string;

  deadline?: number;

  requiresAction: boolean;

  source: {
    type: "onchain" | "official_web" | "governance";
    url?: string;
    ref?: string;
  };

  confidence: number;

  metadata: Record<string, unknown>;
};
```

---

# 11. Event Types for MVP

Keep the first set deliberately small.

Recommended:

```text
ens_expiry
governance_deadline
bridge_claim_ready
token_approval_warning
protocol_migration
position_risk
reward_deadline
```

For a strong demo, even four high-quality event types are enough.

---

# 12. Ingestion Architecture

Numa has two ingestion families:

```text
ONCHAIN
OFFCHAIN
```

---

## 12.1 Onchain ingestion

Potential inputs:

```text
wallet transaction history
token approvals
ENS ownership/expiry
protocol position data
bridge state
governance eligibility
```

The exact provider can vary.

Use provider adapters:

```text
src/onchain/
├── provider.ts
├── evm.ts
├── ens.ts
├── approvals.ts
├── aave.ts
└── bridges.ts
```

Contract:

```ts
interface OnchainAdapter {
  discover(wallet: Wallet): Promise<RawEvent[]>;
}
```

This prevents vendor lock-in.

---

## 12.2 Offchain ingestion

Firecrawl is used for:

```text
official protocol documentation
governance pages
migration notices
reward announcements
changelogs
status pages
```

Numa does not crawl the whole Web3 internet.

It crawls **sources associated with protocols the user actually touches**.

That is the personalization advantage.

---

# 13. Firecrawl Architecture

Pipeline:

```text
Wallet interacts with Protocol X
            ↓
Protocol X subscription created
            ↓
Official sources registered
            ↓
Scheduled Firecrawl refresh
            ↓
Content extraction
            ↓
Content hash comparison
            ↓
Changed?
     ┌──────┴──────┐
     NO            YES
     │              │
     stop           ▼
              relevance analysis
                     │
                     ▼
                 Numa event
```

Persist:

```text
source URL
crawl timestamp
content hash
extracted content
change summary
```

Do not ask OpenAI to interpret the same unchanged page repeatedly.

---

# 14. Change Detection

For crawled pages:

```text
normalized_text
      ↓
hash()
      ↓
compare previous hash
```

If unchanged:

```text
do nothing
```

If changed:

```text
calculate diff
→ send relevant changed section to OpenAI
```

This:

- reduces cost;
- improves signal-to-noise;
- creates clear provenance.

---

# 15. Relevance Engine

A protocol update should not automatically become an inbox item.

Input:

```text
web update
+
user protocol exposure
+
wallet state
```

Output:

```text
relevant?
confidence
reason
affected_wallets[]
```

Example:

```text
Announcement:
Aave V3 Ethereum collateral parameter change

User:
No Aave position

Result:
not primary-inbox relevant
```

Another user:

```text
User:
active Aave borrow

Result:
relevant
```

---

# 16. Priority Engine

Do not let OpenAI freely invent severity.

Use deterministic factors.

Example score:

```text
priority =
0.30 × urgency
+
0.25 × financial_exposure
+
0.20 × action_requirement
+
0.15 × security_impact
+
0.10 × source_confidence
```

Then map:

```text
>= .85 critical
>= .70 high
>= .45 medium
>= .20 low
else info
```

The exact weights can change, but the model should remain inspectable.

---

# 17. OpenAI Layer

OpenAI is used for:

```text
extracting action-relevant meaning from web updates
classifying relevance
creating concise explanations
generating personalized daily briefs
```

It should not be asked:

> "Look at everything and decide what is true."

Instead, provide structured source context.

Example input:

```text
Official source:
Aave governance page

Changed text:
...

Wallet context:
User has active ETH collateral and USDC borrow.

Task:
Return JSON:
- relevance
- summary
- why_it_matters
- recommended_action
```

Output must be schema validated.

---

# 18. LLM Guardrails

Never let model output directly create an urgent financial warning without validation.

Rules:

```text
source must exist
wallet context must exist
critical facts must be derivable from source/provider data
structured output must validate
```

For high severity:

```text
deterministic rule confirmation preferred
```

Example:

Health factor of `1.05` should come from protocol/onchain data.

OpenAI may explain it, not invent it.

---

# 19. Dedupe Strategy

Every event needs a deterministic dedupe key.

Example:

```text
hash(
  user_id
  + wallet
  + event_type
  + protocol
  + external_event_id/version
)
```

For recurring changing metrics:

```text
position_risk:aave:<wallet>:<risk_bucket>
```

Do not create a new event for every tiny metric update.

Update the existing event until the user moves into a new risk bucket.

---

# 20. Event Lifecycle

```text
DISCOVERED
    ↓
NORMALIZED
    ↓
RELEVANCE CHECK
    ↓
IRRELEVANT → archived
    ↓
RELEVANT
    ↓
PRIORITIZED
    ↓
INBOX
    ↓
┌────────┬─────────┬──────────┐
READ    SNOOZE   COMPLETE   DISMISS
```

Deadline events may automatically become:

```text
expired
```

after deadline.

---

# 21. Realtime UX

The UI should subscribe directly to Convex queries.

Recommended:

```text
useQuery(getInbox)
useQuery(getUnreadCount)
useQuery(getTodayTasks)
```

When a backend mutation creates or updates an event, the UI updates reactively.

Do not implement a separate WebSocket service.

---

# 22. AgentMail Integration

AgentMail is used for outbound notification and future inbound workflows.

MVP:

```text
daily digest
urgent event email
deadline reminder
```

Architecture:

```text
Convex scheduler
      ↓
notification action
      ↓
AgentMail
      ↓
user inbox
```

Persist:

```text
notification_id
event_id?
brief_id?
type
recipient
sent_at
status
provider_message_id
```

Future inbound capabilities:

```text
user replies "snooze"
provider communication
email-based commands
```

AgentMail webhooks can feed replies back through a Convex HTTP action.

---

# 23. Brief Generation

Do not ask OpenAI to inspect the entire database.

Flow:

```text
query today's relevant events
        ↓
rank
        ↓
select top N
        ↓
structured summary input
        ↓
OpenAI brief
        ↓
brief record
        ↓
AgentMail delivery
```

Recommended:

```text
max 3–5 important items
```

The product promise is reduced noise.

---

# 24. Authentication

Use an auth provider compatible with Convex.

Options include:

```text
Clerk
Auth0
Convex Auth
```

Requirements:

```text
wallets belong to authenticated user
all reads filtered by user identity
all mutations enforce ownership
```

Public wallet addresses are not secret, but user associations and behavioral state are private application data.

---

# 25. Wallet Connection

MVP options:

### Option A — address input

Lowest risk.

```text
paste wallet
→ verify format
→ read-only monitoring
```

### Option B — wallet connect

Use:

```text
wagmi
viem
RainbowKit
```

No signing required except optional ownership proof.

For hackathon speed, wallet address input + optional signature verification is enough.

---

# 26. Security Model

Numa is read-heavy and non-custodial.

That keeps the attack surface manageable.

Never store:

```text
seed phrases
private keys
exchange secrets
wallet signing keys
```

External API secrets remain server-side.

Every action/mutation validates:

```text
authenticated user
resource ownership
input schema
```

---

# 27. External Content Security

Firecrawl content is untrusted input.

Treat crawled pages as data, never instructions.

Protect against prompt injection by:

- delimiting source content;
- using explicit system instructions;
- requesting schema-only output;
- never exposing secrets in model context;
- never allowing crawled text to invoke tools;
- validating generated fields.

---

# 28. Reliability

External services fail.

Numa must degrade gracefully.

## Firecrawl unavailable

```text
onchain inbox remains available
web source marked stale
retry later
```

## OpenAI unavailable

```text
store event
use deterministic fallback title
retry explanation later
```

## AgentMail unavailable

```text
in-app event unaffected
email queued/retried
```

## Onchain provider unavailable

```text
last-known state remains
source marked stale
recheck scheduled
```

---

# 29. Retry Policy

Use bounded exponential backoff for external actions.

Example:

```text
attempt 1 immediately
attempt 2 +30s
attempt 3 +2m
attempt 4 +10m
```

Do not retry permanent 4xx failures blindly.

Persist failure reason.

---

# 30. Idempotent Jobs

Every scheduled job should be safe to rerun.

Examples:

```text
scanWallet(walletId, scanWindow)
crawlSource(sourceId, contentVersion)
sendDigest(userId, date)
```

Use stable keys to avoid duplicate writes and duplicate emails.

---

# 31. Observability

Structured log context:

```text
user_id
wallet_id
event_id
source_id
job_id
provider
duration_ms
status
```

Key metrics:

```text
wallet scan success rate
crawl success rate
events discovered
events deduplicated
events promoted to inbox
OpenAI classification latency
brief generation success
AgentMail delivery success
```

Product metrics:

```text
DAU
wallets monitored
events opened
tasks completed
events snoozed
email open/click rate
daily brief retention
```

---

# 32. Auditability

For every inbox event, Numa should be able to reconstruct:

```text
what source caused it
what raw data was observed
how it normalized
why it was relevant
why it received its severity
what explanation was generated
```

This is useful for both trust and debugging.

---

# 33. Testing Strategy

## Unit

```text
event normalization
priority scoring
dedupe keys
deadline logic
status transitions
source relevance
```

---

## Contract

Fixtures for:

```text
onchain provider responses
Firecrawl response format
OpenAI structured output
AgentMail responses/webhooks
```

---

## Integration

```text
raw source
→ normalized event
→ relevance
→ priority
→ database
```

---

## E2E

```text
add wallet
→ discover event
→ inbox updates
→ user snoozes
→ event reappears
→ digest sent
```

---

# 34. Demo Fixtures

For a hackathon demo, do not rely entirely on unpredictable live data.

Maintain deterministic demo fixtures for:

```text
Aave risk event
ENS expiry
Arbitrum governance deadline
bridge claim
protocol migration announcement
```

The live application can use real integrations, while demo mode guarantees the narrative works.

Clearly label fixtures/demo data if used.

---

# 35. MVP Protocol Scope

Recommended initial set:

## ENS

Event:

```text
domain expiry
```

## Arbitrum Governance

Event:

```text
proposal deadline
```

## Aave

Event:

```text
health factor risk
```

## One Bridge

Event:

```text
claim ready
```

## ERC-20 approvals

Event:

```text
stale/unlimited approval warning
```

This is enough to prove breadth without building a universal indexer.

---

# 36. Frontend Information Architecture

Routes:

```text
/
 /inbox
 /tasks
 /brief
 /wallets
 /settings
 /event/[id]
```

Primary navigation:

```text
Inbox
Tasks
Brief
```

Keep wallets/settings secondary.

---

# 37. Design Language

Numa should feel closer to:

```text
Linear
Superhuman
Notion
modern fintech
```

than:

```text
crypto trading terminal
```

Avoid:

- excessive neon;
- candlestick-heavy visuals;
- token-price clutter;
- unnecessary Web3 jargon.

The user should feel:

> calm, informed, in control.

---

# 38. Inbox Card Anatomy

```text
[SEVERITY]  [CATEGORY]

Aave health factor is 1.31

Your borrowing position has become riskier.

Review collateral or debt.

Due: Now

[Review] [Snooze]
```

Metadata hidden behind details.

---

# 39. Priority UX

Critical/high:

```text
top of inbox
eligible for immediate email
```

Medium:

```text
normal inbox
included in daily brief
```

Low/info:

```text
lower section
digest only
```

---

# 40. Deployment

Recommended:

```text
Frontend:
Vercel / supported public hosting

Backend:
Convex deployment

External:
Firecrawl
OpenAI
AgentMail
Onchain data provider
```

No separate database.

No Redis for MVP.

No dedicated queue for MVP.

No Kubernetes.

---

# 41. Environment Variables

```text
NEXT_PUBLIC_CONVEX_URL=

OPENAI_API_KEY=
FIRECRAWL_API_KEY=
AGENTMAIL_API_KEY=

ONCHAIN_PROVIDER_URL=
ONCHAIN_PROVIDER_KEY=

ARC_MODE=ADVISORY
```

Never prefix secrets with `NEXT_PUBLIC_`.

---

# 42. Cost Control

Important because web crawling + LLM calls can balloon.

Use:

```text
protocol subscriptions
content hashing
change detection
relevance prefiltering
small prompts
brief batching
crawl intervals by importance
```

Example crawl policy:

```text
governance page: 15–30 min
status page: 5–15 min
docs/changelog: 1–6 hours
static docs: daily
```

---

# 43. Privacy

Numa should communicate clearly:

```text
wallet address monitoring is read-only
Numa does not hold funds
Numa does not require seed phrases
Numa does not execute transactions in MVP
```

The user can delete:

```text
wallet
event history
preferences
account
```

---

# 44. Accessibility

Inbox-first products should be keyboard-friendly.

Support:

```text
clear focus states
high contrast
semantic status labels
not color-only severity
screen-reader-friendly buttons
```

---

# 45. Failure States in UI

Do not silently hide stale data.

Example:

```text
Aave data last refreshed 18 minutes ago.
Provider temporarily unavailable.
```

For crawled source:

```text
Official governance page could not be refreshed.
Last successful check: 09:42 UTC.
```

Trust beats pretending everything is current.

---

# 46. Phase 1 — Hackathon MVP

Goal:

> prove the onchain inbox concept.

Build:

```text
wallet onboarding
3–5 event types
Convex realtime inbox
read/snooze/complete
Firecrawl monitoring
OpenAI explanation
AgentMail daily brief
public demo
```

---

# 47. Phase 2 — Personalization

Add:

```text
more protocols
custom severity preferences
chain preferences
daily briefing preferences
wallet grouping
protocol subscriptions
```

---

# 48. Phase 3 — Action Layer

Potential future actions:

```text
prepare transaction
deep-link to protocol
revoke approval
renew ENS
claim reward
vote
```

Still user-approved.

---

# 49. Phase 4 — Intelligent Automation

Only much later:

```text
policy-driven automation
smart-account actions
delegated permissions
agent wallets
```

This requires a significantly stronger security architecture and should not be part of the hackathon MVP.

---

# 50. Suggested Repository Structure

```text
numa/
│
├── README.md
├── NUMA_ARCHITECTURE.md
├── hackathon.md
├── package.json
├── .env.example
│
├── app/
│   ├── page.tsx
│   ├── inbox/
│   ├── tasks/
│   ├── brief/
│   ├── wallets/
│   └── event/[id]/
│
├── components/
│   ├── inbox/
│   ├── tasks/
│   ├── wallet/
│   └── ui/
│
├── lib/
│   ├── onchain/
│   ├── formatting/
│   └── validation/
│
├── convex/
│   ├── schema.ts
│   ├── users.ts
│   ├── wallets.ts
│   ├── events.ts
│   ├── tasks.ts
│   ├── briefs.ts
│   ├── notifications.ts
│   ├── sources.ts
│   │
│   ├── ingestion/
│   ├── intelligence/
│   ├── jobs/
│   ├── webhooks/
│   └── crons.ts
│
├── tests/
│   ├── unit/
│   ├── contract/
│   └── fixtures/
│
└── public/
```

---

# 51. Engineering Build Order

## Step 1 — Skeleton

```text
Next.js
Convex
auth
schema
basic UI
```

## Step 2 — Wallet model

```text
add wallet
wallet list
wallet ownership
```

## Step 3 — Event model

```text
canonical ArcEvent
dedupe
inbox query
```

## Step 4 — Demo event source

```text
fixture events
realtime inbox
status actions
```

## Step 5 — First real onchain adapter

Recommended:

```text
ENS expiry
```

## Step 6 — Firecrawl source monitoring

```text
protocol source
change detection
normalization
```

## Step 7 — OpenAI explanation

```text
structured output
source-grounded summaries
```

## Step 8 — AgentMail

```text
daily brief
urgent email
```

## Step 9 — More event types

```text
governance
approval warning
Aave risk
bridge claim
```

## Step 10 — Polish + demo

```text
loading states
error states
empty state
demo fixtures
hackathon.md
video
```

---

# 52. Definition of Done

The hackathon MVP is complete when:

```text
✓ user can add a wallet

✓ Numa can discover or simulate multiple event types

✓ every event is normalized into one canonical schema

✓ events deduplicate correctly

✓ inbox updates in realtime

✓ user can read, snooze, dismiss and complete items

✓ Firecrawl discovers a real official protocol change

✓ Numa only surfaces that change when relevant

✓ OpenAI produces source-grounded explanation

✓ AgentMail delivers a digest

✓ no transaction signing is required

✓ no secrets/private keys are stored

✓ errors and stale data are visible

✓ public deployment works

✓ demo can be completed in under 3 minutes
```

---

# 53. Hackathon Demo Architecture

The ideal demo sequence:

```text
1. Enter wallet

2. Numa discovers:
   ENS
   Aave
   governance activity

3. Inbox instantly shows:
   renewal
   risk
   voting deadline

4. Open one item:
   what happened
   why it matters
   next action

5. Firecrawl detects a new official migration announcement

6. Relevance engine matches it to the user's protocol exposure

7. OpenAI generates a concise explanation

8. Convex pushes the new event into the open browser live

9. User snoozes one task and completes another

10. AgentMail sends the personalized Numa brief
```

That proves:

```text
consumer usefulness
Convex depth
Firecrawl integration
OpenAI intelligence
AgentMail integration
realtime UX
```

in a single story.

---

# 54. Product Positioning

Primary:

> **Numa — Your onchain inbox.**

Supporting:

> **Everything your wallet needs you to know.**

> **One wallet. Every action that matters.**

> **Claim. Renew. Vote. Migrate. Protect.**

---

# 55. Strategic Differentiation

Numa is not trying to beat portfolio trackers at portfolio tracking.

It creates a different category:

```text
ONCHAIN ATTENTION MANAGEMENT
```

The defensible loop becomes:

```text
more wallet context
      ↓
better relevance
      ↓
better prioritization
      ↓
higher daily usefulness
      ↓
more user feedback
      ↓
better personalization
```

The long-term product is not merely:

> "notifications for wallets."

It is:

> **the personal operating layer that organizes everything requiring a user's attention across Web3.**

---

# 56. Source-of-Truth Rule

`NUMA_ARCHITECTURE.md` is the technical source of truth for Numa.

If implementation needs to diverge materially:

1. document the reason;
2. update this architecture;
3. then change the implementation.

For the hackathon, prioritize:

```text
correctness
clarity
realtime behavior
actionability
polish
```

over architectural complexity.

The best Numa MVP is not the one supporting the most protocols.

It is the one where a judge enters a wallet and immediately thinks:

> **"I actually want this."**
