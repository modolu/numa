import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    identitySubject: v.string(),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    timezone: v.string(),
    createdAt: v.number(),
  }).index("by_identity_subject", ["identitySubject"]),

  wallets: defineTable({
    userId: v.id("users"),
    address: v.string(),
    chainFamily: v.string(),
    label: v.optional(v.string()),
    isPrimary: v.boolean(),
    createdAt: v.number(),
    lastScannedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_address", ["address"]),

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
    sourceType: v.string(),
    url: v.string(),
    crawlPolicy: v.string(),
    lastCrawledAt: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    isActive: v.boolean(),
  }).index("by_protocol", ["protocolId"]),

  rawEvents: defineTable({
    source: v.string(),
    sourceEventId: v.string(),
    walletId: v.optional(v.id("wallets")),
    protocolId: v.optional(v.id("protocols")),
    chainId: v.optional(v.number()),
    payload: v.any(),
    observedAt: v.number(),
    contentHash: v.optional(v.string()),
    processingStatus: v.string(),
  }).index("by_source_event", ["source", "sourceEventId"]),

  events: defineTable({
    dedupeKey: v.string(),
    userId: v.id("users"),
    walletId: v.optional(v.id("wallets")),
    protocolId: v.optional(v.id("protocols")),
    chainId: v.optional(v.number()),
    eventType: v.string(),
    category: v.string(),
    severity: v.string(),
    title: v.string(),
    summary: v.string(),
    whyItMatters: v.string(),
    recommendedAction: v.optional(v.string()),
    actionUrl: v.optional(v.string()),
    deadline: v.optional(v.number()),
    occurredAt: v.optional(v.number()),
    detectedAt: v.number(),
    updatedAt: v.number(),
    status: v.string(),
    requiresAction: v.boolean(),
    sourceType: v.string(),
    sourceUrl: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
    confidence: v.number(),
    metadata: v.any(),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_dedupe_key", ["dedupeKey"]),

  tasks: defineTable({
    userId: v.id("users"),
    eventId: v.id("events"),
    title: v.string(),
    status: v.string(),
    dueAt: v.optional(v.number()),
    snoozeUntil: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_event", ["eventId"]),

  briefs: defineTable({
    userId: v.id("users"),
    period: v.string(),
    generatedAt: v.number(),
    headline: v.string(),
    summary: v.string(),
    eventIds: v.array(v.id("events")),
    sentViaEmail: v.boolean(),
  }).index("by_user_period", ["userId", "period"]),

  userProtocolSubscriptions: defineTable({
    userId: v.id("users"),
    walletId: v.id("wallets"),
    protocolId: v.id("protocols"),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    confidence: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_protocol", ["userId", "protocolId"]),

  notificationPreferences: defineTable({
    userId: v.id("users"),
    emailDigestEnabled: v.boolean(),
    urgentEmailEnabled: v.boolean(),
    digestTime: v.string(),
    timezone: v.string(),
    minimumEmailSeverity: v.string(),
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
