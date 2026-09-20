/**
 * Numa data model. Source of truth: NUMA_ARCHITECTURE.md §9.
 *
 * Fully implemented for this milestone: wallets, rawEvents, events, tasks.
 * The remaining tables carry their architecture-defined fields so later
 * milestones (protocol subscriptions, briefs, notifications) can build on
 * them without a migration, but have no behaviour yet.
 *
 * Additive fields beyond §9 (documented, not a redesign):
 *  - events.priorityScore  — keeps the deterministic priority engine (§16)
 *                             inspectable from the UI and the dashboard.
 *  - events.isDemo         — fixture/demo labelling required by §34.
 *  - events.snoozeUntil    — snooze timestamp so the scheduler wake-up (§8)
 *                             can be added without a schema change.
 *  - events.readAt / completedAt / dismissedAt — lifecycle audit stamps (§32).
 *  - protocolSources.previous/latest content fields + crawl health — change
 *                             detection state and provenance (§13, §14).
 *  - userProtocolSubscriptions.origin / evidence — live vs demo exposure.
 *  - interpretations (table) — per source-version/user AI interpretation
 *                             state: status, model, version, validated result.
 *  - briefs.items / remaining / notificationId — brief snapshot for email.
 *  - notifications.dedupeKey / attempts / scheduledFor / scheduledFunctionId /
 *    reminderOffset / notifiedSeverity / isTest — idempotent delivery,
 *    reminder scheduling and urgent-alert escalation state (§22, §30).
 *  - wallets.lastScanAttemptAt / lastScanStatus / lastScanError — scan health
 *                             so provider failures are visible without
 *                             touching last-known-good event data (§28, §45).
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  chainFamilyValidator,
  crawlPolicyValidator,
  protocolSourceTypeValidator,
  eventCategoryValidator,
  eventSeverityValidator,
  eventStatusValidator,
  eventTypeValidator,
  sourceTypeValidator,
} from "./lib/validators";

export default defineSchema({
  users: defineTable({
    // Stable identity key. For the hackathon this is the demo identity from
    // convex/lib/identity.ts; a real auth provider's tokenIdentifier later.
    identitySubject: v.string(),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    timezone: v.string(),
    createdAt: v.number(),
  }).index("by_identity_subject", ["identitySubject"]),

  wallets: defineTable({
    userId: v.id("users"),
    // Always stored lowercased (lib/validation/wallet.ts).
    address: v.string(),
    chainFamily: chainFamilyValidator,
    label: v.optional(v.string()),
    isPrimary: v.boolean(),
    createdAt: v.number(),
    // Last *successful* scan. Never cleared by a failed scan (§28).
    lastScannedAt: v.optional(v.number()),
    // Minimal scan-health metadata for stale/failed states (§45).
    lastScanAttemptAt: v.optional(v.number()),
    lastScanStatus: v.optional(
      v.union(v.literal("ok"), v.literal("failed"), v.literal("running")),
    ),
    lastScanError: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_address", ["address"])
    .index("by_user_and_address", ["userId", "address"]),

  protocols: defineTable({
    slug: v.string(),
    name: v.string(),
    category: v.string(),
    officialDomain: v.string(),
    iconUrl: v.optional(v.string()),
    supportedChains: v.array(v.number()),
    // Additional official hostnames allowed for sources (docs/forum domains).
    officialHosts: v.optional(v.array(v.string())),
  }).index("by_slug", ["slug"]),

  // Official pages Numa monitors (§9, §13). The latest normalized content is
  // kept on the row (bounded) together with the previous/current hash: enough
  // for change detection, provenance and later interpretation without an
  // unbounded snapshot history.
  protocolSources: defineTable({
    protocolId: v.id("protocols"),
    sourceType: protocolSourceTypeValidator,
    url: v.string(),
    crawlPolicy: crawlPolicyValidator,
    isActive: v.boolean(),
    lastCrawledAt: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    previousContentHash: v.optional(v.string()),
    latestContent: v.optional(v.string()),
    latestTitle: v.optional(v.string()),
    latestContentLength: v.optional(v.number()),
    lastChangedAt: v.optional(v.number()),
    // Crawl health (§28, §45). `lastCrawledAt` is the last *successful* crawl.
    lastCrawlAttemptAt: v.optional(v.number()),
    lastCrawlStatus: v.optional(
      v.union(v.literal("ok"), v.literal("failed"), v.literal("running")),
    ),
    lastCrawlError: v.optional(v.string()),
  })
    .index("by_protocol", ["protocolId"])
    .index("by_url", ["url"])
    .index("by_is_active", ["isActive"]),

  // Source-specific discovery before normalization. Kept for replay,
  // debugging, auditability and deduplication (§9).
  rawEvents: defineTable({
    source: v.string(),
    sourceEventId: v.string(),
    walletId: v.optional(v.id("wallets")),
    protocolId: v.optional(v.id("protocols")),
    chainId: v.optional(v.number()),
    payload: v.any(),
    observedAt: v.number(),
    contentHash: v.optional(v.string()),
    processingStatus: v.union(
      v.literal("pending"),
      v.literal("normalized"),
      v.literal("irrelevant"),
      v.literal("failed"),
    ),
    // Set once the pipeline has promoted this raw observation to the inbox.
    eventId: v.optional(v.id("events")),
  })
    .index("by_source_and_source_event_id", ["source", "sourceEventId"])
    .index("by_wallet", ["walletId"]),

  // Canonical Numa event (§9, §10).
  events: defineTable({
    dedupeKey: v.string(),

    userId: v.id("users"),
    walletId: v.optional(v.id("wallets")),

    protocolId: v.optional(v.id("protocols")),
    chainId: v.optional(v.number()),

    eventType: eventTypeValidator,
    category: eventCategoryValidator,
    severity: eventSeverityValidator,

    title: v.string(),
    summary: v.string(),
    whyItMatters: v.string(),
    recommendedAction: v.optional(v.string()),
    actionUrl: v.optional(v.string()),

    deadline: v.optional(v.number()),
    occurredAt: v.optional(v.number()),
    detectedAt: v.number(),
    updatedAt: v.number(),

    status: eventStatusValidator,
    requiresAction: v.boolean(),

    sourceType: sourceTypeValidator,
    sourceUrl: v.optional(v.string()),
    sourceRef: v.optional(v.string()),

    confidence: v.number(),
    priorityScore: v.number(),

    isDemo: v.boolean(),
    metadata: v.record(v.string(), v.any()),

    snoozeUntil: v.optional(v.number()),
    readAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    dismissedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_status", ["userId", "status"])
    .index("by_user_and_dedupe_key", ["userId", "dedupeKey"]),

  tasks: defineTable({
    userId: v.id("users"),
    eventId: v.id("events"),
    title: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("snoozed"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    recommendedActionUrl: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    snoozeUntil: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_status", ["userId", "status"])
    .index("by_event", ["eventId"]),

  // One row per (source version, user): audit trail and cost control for the
  // OpenAI interpretation step (§17, §18). Stores validated output only —
  // never prompts, raw model text or hidden reasoning.
  interpretations: defineTable({
    sourceId: v.id("protocolSources"),
    contentHash: v.string(),
    userId: v.id("users"),
    walletId: v.id("wallets"),
    eventId: v.id("events"),
    version: v.string(),
    inputHash: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("ok"),
      v.literal("rejected"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    interpretedAt: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    errorKind: v.optional(v.string()),
    lastError: v.optional(v.string()),
    result: v.optional(
      v.object({
        relevant: v.boolean(),
        confidence: v.number(),
        eventType: eventTypeValidator,
        category: eventCategoryValidator,
        headline: v.string(),
        summary: v.string(),
        whyItMatters: v.string(),
        recommendedAction: v.optional(v.string()),
        requiresAction: v.boolean(),
        deadline: v.optional(v.number()),
        deadlineEvidence: v.optional(v.string()),
        claimedSeverity: eventSeverityValidator,
        severity: eventSeverityValidator,
        priorityScore: v.number(),
        severityCapped: v.boolean(),
        evidence: v.array(v.string()),
        unsupportedClaims: v.array(v.string()),
        relevanceReason: v.string(),
        notes: v.array(v.string()),
        exposureOrigin: v.union(v.literal("live"), v.literal("demo")),
      }),
    ),
  })
    .index("by_source_and_hash_and_user", ["sourceId", "contentHash", "userId"])
    .index("by_event", ["eventId"])
    .index("by_user", ["userId"]),

  // Daily briefs (§4.3, §23): a self-contained snapshot of the few canonical
  // events that mattered, so the email renders the same later.
  briefs: defineTable({
    userId: v.id("users"),
    /** Local calendar date in the user's timezone, YYYY-MM-DD. */
    period: v.string(),
    generatedAt: v.number(),
    headline: v.string(),
    summary: v.string(),
    eventIds: v.array(v.id("events")),
    items: v.array(
      v.object({
        eventId: v.id("events"),
        title: v.string(),
        whyItMatters: v.string(),
        recommendedAction: v.optional(v.string()),
        severity: eventSeverityValidator,
        category: eventCategoryValidator,
        deadline: v.optional(v.number()),
        actionUrl: v.optional(v.string()),
        sourceLabel: v.string(),
        isDemo: v.boolean(),
        interpreted: v.boolean(),
      }),
    ),
    remaining: v.number(),
    sentViaEmail: v.boolean(),
    notificationId: v.optional(v.id("notifications")),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_period", ["userId", "period"]),

  userProtocolSubscriptions: defineTable({
    userId: v.id("users"),
    walletId: v.id("wallets"),
    protocolId: v.id("protocols"),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    confidence: v.number(),
    // "live" = backed by a real onchain observation; "demo" = fixture only.
    origin: v.union(v.literal("live"), v.literal("demo")),
    // Event types that established the exposure, e.g. "ens_expiry".
    evidence: v.array(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_protocol", ["userId", "protocolId"])
    .index("by_protocol", ["protocolId"])
    .index("by_wallet_and_protocol", ["walletId", "protocolId"]),

  notificationPreferences: defineTable({
    userId: v.id("users"),
    emailDigestEnabled: v.boolean(),
    urgentEmailEnabled: v.boolean(),
    /** "HH:MM" local time. */
    digestTime: v.string(),
    /** IANA timezone, e.g. "Europe/London". */
    timezone: v.string(),
    minimumEmailSeverity: eventSeverityValidator,
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Outbound notifications (§22): every attempt is persisted and auditable;
  // `dedupeKey` is the logical identity so retries and reruns never send
  // the same message twice.
  notifications: defineTable({
    userId: v.id("users"),
    eventId: v.optional(v.id("events")),
    briefId: v.optional(v.id("briefs")),
    type: v.union(
      v.literal("daily_brief"),
      v.literal("urgent_event"),
      v.literal("deadline_reminder"),
      v.literal("test_brief"),
    ),
    /** Masked recipient (a***@domain); the real address is resolved at send time. */
    recipient: v.string(),
    subject: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("cancelled"),
      // Provider lifecycle (webhook-ready; not yet driven by a live webhook).
      v.literal("delivered"),
      v.literal("bounced"),
      v.literal("rejected"),
      v.literal("complained"),
    ),
    dedupeKey: v.string(),
    attempts: v.number(),
    createdAt: v.number(),
    lastAttemptAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    providerMessageId: v.optional(v.string()),
    failureKind: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    /** Deadline reminders: when to fire, and the scheduled function to cancel. */
    scheduledFor: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    /** Reminder offset label, e.g. "24h" / "1h". */
    reminderOffset: v.optional(v.string()),
    /** Severity the user was alerted at (urgent dedupe/escalation). */
    notifiedSeverity: v.optional(eventSeverityValidator),
    isTest: v.optional(v.boolean()),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_status", ["userId", "status"])
    .index("by_dedupe_key", ["dedupeKey"])
    .index("by_event", ["eventId"])
    .index("by_provider_message_id", ["providerMessageId"]),
});
