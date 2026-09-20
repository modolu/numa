/**
 * Canonical events: inbox queries, lifecycle mutations and the deduplicating
 * upsert every ingestion path funnels through (NUMA_ARCHITECTURE.md §8, §19,
 * §20).
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type { EventStatus, NumaEvent } from "../lib/validation/events";
import { numaEventValidator } from "./lib/validators";
import { getCurrentUser, requireUser } from "./lib/identity";
import { requireOwnedEvent } from "./lib/access";
import { contentHash } from "./lib/hash";
import { canComplete, canTransition, isValidSnoozeUntil } from "./lib/lifecycle";
import { sortInbox } from "./lib/inboxOrder";

const INBOX_PAGE = 200;

// ---------------------------------------------------------------------------
// Upsert (dedupe engine)
// ---------------------------------------------------------------------------

export type UpsertOutcome = {
  eventId: Id<"events">;
  outcome: "created" | "updated" | "unchanged";
};

/** Flatten the canonical contract's nested `source` into stored columns. */
function toContentFields(event: NumaEvent) {
  return {
    walletId: event.walletId,
    protocolId: event.protocolId,
    chainId: event.chainId,
    eventType: event.eventType,
    category: event.category,
    severity: event.severity,
    title: event.title,
    summary: event.summary,
    whyItMatters: event.whyItMatters,
    recommendedAction: event.recommendedAction,
    actionUrl: event.actionUrl,
    deadline: event.deadline,
    occurredAt: event.occurredAt,
    requiresAction: event.requiresAction,
    sourceType: event.source.type,
    sourceUrl: event.source.url,
    sourceRef: event.source.ref,
    confidence: event.confidence,
    priorityScore: event.priorityScore,
    isDemo: event.isDemo,
    metadata: event.metadata,
  };
}

type ContentFields = ReturnType<typeof toContentFields>;

function fingerprint(fields: ContentFields): string {
  return contentHash(fields);
}

function existingContentFields(doc: Doc<"events">): ContentFields {
  return {
    walletId: doc.walletId,
    protocolId: doc.protocolId,
    chainId: doc.chainId,
    eventType: doc.eventType,
    category: doc.category,
    severity: doc.severity,
    title: doc.title,
    summary: doc.summary,
    whyItMatters: doc.whyItMatters,
    recommendedAction: doc.recommendedAction,
    actionUrl: doc.actionUrl,
    deadline: doc.deadline,
    occurredAt: doc.occurredAt,
    requiresAction: doc.requiresAction,
    sourceType: doc.sourceType,
    sourceUrl: doc.sourceUrl,
    sourceRef: doc.sourceRef,
    confidence: doc.confidence,
    priorityScore: doc.priorityScore,
    isDemo: doc.isDemo,
    metadata: doc.metadata,
  };
}

/**
 * Insert a canonical event or update the existing one with the same dedupe
 * key. User state (status, snooze, read/complete stamps) is never touched
 * by ingestion, so a re-observed event cannot "un-read" or revive itself.
 */
export async function upsertNormalizedEventHelper(
  ctx: MutationCtx,
  event: NumaEvent,
  now: number,
): Promise<UpsertOutcome> {
  const content = toContentFields(event);
  const existing = await ctx.db
    .query("events")
    .withIndex("by_user_and_dedupe_key", (q) =>
      q.eq("userId", event.userId).eq("dedupeKey", event.dedupeKey),
    )
    .unique();

  if (!existing) {
    const eventId = await ctx.db.insert("events", {
      dedupeKey: event.dedupeKey,
      userId: event.userId,
      ...content,
      status: "unread",
      detectedAt: now,
      updatedAt: now,
    });
    return { eventId, outcome: "created" };
  }

  if (fingerprint(existingContentFields(existing)) === fingerprint(content)) {
    return { eventId: existing._id, outcome: "unchanged" };
  }
  // An interpreted event is never overwritten by a generic re-observation of
  // the same logical event (e.g. a crawl retry): the richer copy wins.
  if (existing.metadata.interpreted === true && event.metadata.interpreted === false) {
    return { eventId: existing._id, outcome: "unchanged" };
  }

  await ctx.db.patch("events", existing._id, { ...content, updatedAt: now });
  return { eventId: existing._id, outcome: "updated" };
}

/**
 * Internal entry point for actions (wallet scans, crawls) that run outside
 * the mutation transaction. Not public: clients must never inject events.
 */
export const upsertNormalizedEvent = internalMutation({
  args: { event: numaEventValidator, now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<UpsertOutcome> => {
    return await upsertNormalizedEventHelper(
      ctx,
      args.event,
      args.now ?? Date.now(),
    );
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function eventsByStatus(
  ctx: Parameters<typeof getCurrentUser>[0],
  userId: Id<"users">,
  status: EventStatus,
  limit: number,
): Promise<Doc<"events">[]> {
  return await ctx.db
    .query("events")
    .withIndex("by_user_and_status", (q) =>
      q.eq("userId", userId).eq("status", status),
    )
    .take(limit);
}

export const getInbox = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { attention: [], snoozed: [], done: [] };

    const [unread, read, snoozed, completed, dismissed] = await Promise.all([
      eventsByStatus(ctx, user._id, "unread", INBOX_PAGE),
      eventsByStatus(ctx, user._id, "read", INBOX_PAGE),
      eventsByStatus(ctx, user._id, "snoozed", INBOX_PAGE),
      eventsByStatus(ctx, user._id, "completed", 50),
      eventsByStatus(ctx, user._id, "dismissed", 50),
    ]);

    const done = [...completed, ...dismissed].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );

    return {
      attention: sortInbox([...unread, ...read]),
      snoozed: sortInbox(snoozed),
      done,
    };
  },
});

export const getUnreadCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const user = await getCurrentUser(ctx);
    if (!user) return 0;
    // Bounded read; a denormalized counter replaces this if inboxes grow.
    const unread = await eventsByStatus(ctx, user._id, "unread", 100);
    return unread.length;
  },
});

export const getEvent = query({
  // Accepts a raw string so a malformed URL id yields "not found" instead of
  // an argument validation error.
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const eventId = ctx.db.normalizeId("events", args.eventId);
    if (!eventId) return null;
    const event = await ctx.db.get("events", eventId);
    if (!event || event.userId !== user._id) return null;

    const [wallet, protocol, task] = await Promise.all([
      event.walletId ? ctx.db.get("wallets", event.walletId) : null,
      event.protocolId ? ctx.db.get("protocols", event.protocolId) : null,
      ctx.db
        .query("tasks")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .unique(),
    ]);

    // Offchain events point at the monitored source that produced them.
    const sourceId =
      typeof event.metadata.sourceId === "string"
        ? ctx.db.normalizeId("protocolSources", event.metadata.sourceId)
        : null;
    const monitoredSource = sourceId ? await ctx.db.get("protocolSources", sourceId) : null;
    const interpretationRow = monitoredSource
      ? await ctx.db
          .query("interpretations")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .unique()
      : null;

    return {
      event,
      interpretation: interpretationRow
        ? {
            status: interpretationRow.status,
            attempts: interpretationRow.attempts,
            model: interpretationRow.model,
            version: interpretationRow.version,
            interpretedAt: interpretationRow.interpretedAt,
            errorKind: interpretationRow.errorKind,
            result: interpretationRow.result ?? null,
          }
        : null,
      source: monitoredSource
        ? {
            _id: monitoredSource._id,
            url: monitoredSource.url,
            sourceType: monitoredSource.sourceType,
            crawlPolicy: monitoredSource.crawlPolicy,
            lastCrawledAt: monitoredSource.lastCrawledAt,
            lastChangedAt: monitoredSource.lastChangedAt,
            lastCrawlStatus: monitoredSource.lastCrawlStatus,
            contentHash: monitoredSource.contentHash?.slice(0, 12),
          }
        : null,
      wallet: wallet
        ? { _id: wallet._id, address: wallet.address, label: wallet.label }
        : null,
      protocol: protocol
        ? {
            _id: protocol._id,
            slug: protocol.slug,
            name: protocol.name,
            officialDomain: protocol.officialDomain,
          }
        : null,
      task,
    };
  },
});

// ---------------------------------------------------------------------------
// Lifecycle mutations
// ---------------------------------------------------------------------------

function requireTransition(event: Doc<"events">, to: EventStatus): void {
  if (!canTransition(event.status, to)) {
    throw new ConvexError(
      `This item is ${event.status} and can no longer be marked ${to}.`,
    );
  }
}

async function syncTaskStatus(
  ctx: MutationCtx,
  eventId: Id<"events">,
  patch: Partial<Pick<Doc<"tasks">, "status" | "snoozeUntil" | "completedAt">>,
): Promise<void> {
  const task = await ctx.db
    .query("tasks")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .unique();
  if (task && task.status !== "completed" && task.status !== "cancelled") {
    await ctx.db.patch("tasks", task._id, patch);
  }
}

export const markRead = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const event = await requireOwnedEvent(ctx, user._id, args.eventId);
    if (event.status === "read") return null; // idempotent
    requireTransition(event, "read");
    const now = Date.now();
    await ctx.db.patch("events", event._id, {
      status: "read",
      readAt: event.readAt ?? now,
      updatedAt: now,
      snoozeUntil: undefined,
    });
    if (event.status === "snoozed") {
      await syncTaskStatus(ctx, event._id, {
        status: "open",
        snoozeUntil: undefined,
      });
    }
    return null;
  },
});

export const snoozeEvent = mutation({
  args: { eventId: v.id("events"), until: v.number() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const event = await requireOwnedEvent(ctx, user._id, args.eventId);
    const now = Date.now();
    if (!isValidSnoozeUntil(args.until, now)) {
      throw new ConvexError("Snooze time must be in the future.");
    }
    requireTransition(event, "snoozed");
    await ctx.db.patch("events", event._id, {
      status: "snoozed",
      snoozeUntil: args.until,
      updatedAt: now,
    });
    await syncTaskStatus(ctx, event._id, {
      status: "snoozed",
      snoozeUntil: args.until,
    });
    return null;
  },
});

/** Bring a snoozed item back to the inbox (the scheduler wake-up path). */
export const unsnoozeEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const event = await requireOwnedEvent(ctx, user._id, args.eventId);
    requireTransition(event, "unread");
    const now = Date.now();
    await ctx.db.patch("events", event._id, {
      status: "unread",
      snoozeUntil: undefined,
      updatedAt: now,
    });
    await syncTaskStatus(ctx, event._id, {
      status: "open",
      snoozeUntil: undefined,
    });
    return null;
  },
});

export const dismissEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const event = await requireOwnedEvent(ctx, user._id, args.eventId);
    requireTransition(event, "dismissed");
    const now = Date.now();
    await ctx.db.patch("events", event._id, {
      status: "dismissed",
      dismissedAt: now,
      snoozeUntil: undefined,
      updatedAt: now,
    });
    await syncTaskStatus(ctx, event._id, {
      status: "cancelled",
      snoozeUntil: undefined,
    });
    return null;
  },
});

/** Complete an actionable event and its task in one step. */
export const completeEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const event = await requireOwnedEvent(ctx, user._id, args.eventId);
    if (!event.requiresAction) {
      throw new ConvexError("This item has nothing to complete — dismiss it instead.");
    }
    if (!canComplete(event)) {
      requireTransition(event, "completed");
    }
    const now = Date.now();
    await ctx.db.patch("events", event._id, {
      status: "completed",
      completedAt: now,
      snoozeUntil: undefined,
      updatedAt: now,
    });
    await syncTaskStatus(ctx, event._id, {
      status: "completed",
      completedAt: now,
      snoozeUntil: undefined,
    });
    return null;
  },
});
