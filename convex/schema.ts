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
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  chainFamilyValidator,
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
    lastScannedAt: v.optional(v.number()),
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
  }).index("by_slug", ["slug"]),

  protocolSources: defineTable({
    protocolId: v.id("protocols"),
    sourceType: v.union(
      v.literal("docs"),
      v.literal("blog"),
      v.literal("governance"),
      v.literal("changelog"),
      v.literal("status"),
      v.literal("announcement"),
    ),
    url: v.string(),
    crawlPolicy: v.string(),
    lastCrawledAt: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    isActive: v.boolean(),
  }).index("by_protocol", ["protocolId"]),

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

  briefs: defineTable({
    userId: v.id("users"),
    period: v.string(),
    generatedAt: v.number(),
    headline: v.string(),
    summary: v.string(),
    eventIds: v.array(v.id("events")),
    sentViaEmail: v.boolean(),
  }).index("by_user_and_period", ["userId", "period"]),

  userProtocolSubscriptions: defineTable({
    userId: v.id("users"),
    walletId: v.id("wallets"),
    protocolId: v.id("protocols"),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    confidence: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_protocol", ["userId", "protocolId"]),

  notificationPreferences: defineTable({
    userId: v.id("users"),
    emailDigestEnabled: v.boolean(),
    urgentEmailEnabled: v.boolean(),
    digestTime: v.string(),
    timezone: v.string(),
    minimumEmailSeverity: eventSeverityValidator,
  }).index("by_user", ["userId"]),

  notifications: defineTable({
    userId: v.id("users"),
    eventId: v.optional(v.id("events")),
    briefId: v.optional(v.id("briefs")),
    type: v.string(),
    recipient: v.string(),
    sentAt: v.optional(v.number()),
    status: v.string(),
    providerMessageId: v.optional(v.string()),
    dedupeKey: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_dedupe_key", ["dedupeKey"]),
});
