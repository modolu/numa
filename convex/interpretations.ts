/**
 * Interpretation state (§14–§18). One row per (source version, user) keeps
 * the same content from being sent to the model twice, records what was
 * decided and why, and lets the generic `protocol_update` event be upgraded
 * in place while preserving the user's read/snooze/dismiss state.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { ExposureContext } from "../lib/ai/provider";
import { INTERPRETATION_VERSION } from "../lib/ai/input";
import { eventCategoryValidator, eventSeverityValidator, eventTypeValidator } from "./lib/validators";
import { syncTaskForEvent } from "./tasks";
import { onEventChanged } from "./notifications";

const RUNNING_STALE_MS = 3 * 60_000;
export const MAX_INTERPRETATION_ATTEMPTS = 3;
/** Bounded exponential backoff for transient failures (§29). */
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const;

export type InterpretationResult = NonNullable<Doc<"interpretations">["result"]>;

export const interpretationResultValidator = v.object({
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
});

/**
 * Ensure a pending interpretation exists for this source version + user and
 * schedule it. Idempotent: an existing ok/rejected/running row is left
 * alone; a failed row that still has attempts left is re-queued.
 */
export async function ensureInterpretationScheduled(
  ctx: MutationCtx,
  args: {
    sourceId: Id<"protocolSources">;
    contentHash: string;
    userId: Id<"users">;
    walletId: Id<"wallets">;
    eventId: Id<"events">;
    now: number;
  },
): Promise<{ interpretationId: Id<"interpretations">; scheduled: boolean }> {
  const existing = await ctx.db
    .query("interpretations")
    .withIndex("by_source_and_hash_and_user", (q) =>
      q.eq("sourceId", args.sourceId).eq("contentHash", args.contentHash).eq("userId", args.userId),
    )
    .unique();

  if (existing) {
    if (existing.version !== INTERPRETATION_VERSION) {
      // Prompt/schema changed: re-interpret under the new version, once.
      await ctx.db.patch("interpretations", existing._id, {
        version: INTERPRETATION_VERSION,
        status: "pending",
        attempts: 0,
        errorKind: undefined,
        lastError: undefined,
      });
      await ctx.scheduler.runAfter(0, internal.ingestion.interpret.run, { interpretationId: existing._id });
      return { interpretationId: existing._id, scheduled: true };
    }
    const retryable =
      existing.status === "failed" &&
      existing.errorKind === "transient" &&
      existing.attempts < MAX_INTERPRETATION_ATTEMPTS;
    if (existing.status === "pending" || retryable) {
      await ctx.scheduler.runAfter(0, internal.ingestion.interpret.run, { interpretationId: existing._id });
      return { interpretationId: existing._id, scheduled: true };
    }
    return { interpretationId: existing._id, scheduled: false };
  }

  const interpretationId = await ctx.db.insert("interpretations", {
    sourceId: args.sourceId,
    contentHash: args.contentHash,
    userId: args.userId,
    walletId: args.walletId,
    eventId: args.eventId,
    version: INTERPRETATION_VERSION,
    status: "pending",
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.ingestion.interpret.run, { interpretationId });
  return { interpretationId, scheduled: true };
}

export type InterpretationContext = {
  interpretation: Doc<"interpretations">;
  source: Pick<Doc<"protocolSources">, "_id" | "url" | "sourceType" | "latestTitle" | "latestContent" | "contentHash" | "previousContentHash">;
  protocol: Pick<Doc<"protocols">, "_id" | "slug" | "name">;
  event: Doc<"events">;
  exposure: ExposureContext;
};

/** Everything the action needs, in one read. `null` when nothing to do. */
export const getContext = internalQuery({
  args: { interpretationId: v.id("interpretations") },
  handler: async (ctx, args): Promise<InterpretationContext | null> => {
    const interpretation = await ctx.db.get("interpretations", args.interpretationId);
    if (!interpretation) return null;
    const [source, event, wallet] = await Promise.all([
      ctx.db.get("protocolSources", interpretation.sourceId),
      ctx.db.get("events", interpretation.eventId),
      ctx.db.get("wallets", interpretation.walletId),
    ]);
    if (!source || !event || !wallet) return null;
    const protocol = await ctx.db.get("protocols", source.protocolId);
    if (!protocol) return null;

    const subscription = await ctx.db
      .query("userProtocolSubscriptions")
      .withIndex("by_wallet_and_protocol", (q) => q.eq("walletId", wallet._id).eq("protocolId", protocol._id))
      .unique();
    // Deterministic facts Numa already holds for this wallet + protocol:
    // titles of live (non-demo) events other than source updates.
    const walletEvents = await ctx.db
      .query("events")
      .withIndex("by_user", (q) => q.eq("userId", interpretation.userId))
      .take(300);
    const knownFacts = walletEvents
      .filter((e) => e.walletId === wallet._id && e.protocolId === protocol._id && !e.isDemo && e.eventType !== "protocol_update")
      .map((e) => `${e.title} (${e.eventType}${e.deadline ? `, deadline ${new Date(e.deadline).toISOString()}` : ""})`)
      .slice(0, 10);

    return {
      interpretation,
      source: {
        _id: source._id,
        url: source.url,
        sourceType: source.sourceType,
        latestTitle: source.latestTitle,
        latestContent: source.latestContent,
        contentHash: source.contentHash,
        previousContentHash: source.previousContentHash,
      },
      protocol: { _id: protocol._id, slug: protocol.slug, name: protocol.name },
      event,
      exposure: {
        protocolSlug: protocol.slug,
        protocolName: protocol.name,
        origin: subscription?.origin ?? "demo",
        evidence: subscription?.evidence ?? [],
        knownFacts,
      },
    };
  },
});

export const markRunning = internalMutation({
  args: { interpretationId: v.id("interpretations"), now: v.number() },
  handler: async (ctx, args): Promise<{ started: boolean; reason?: string; attempts: number }> => {
    const row = await ctx.db.get("interpretations", args.interpretationId);
    if (!row) return { started: false, reason: "not found", attempts: 0 };
    if (row.status === "ok" || row.status === "rejected") {
      return { started: false, reason: `already ${row.status}`, attempts: row.attempts };
    }
    if (row.status === "running" && args.now - (row.lastAttemptAt ?? 0) < RUNNING_STALE_MS) {
      return { started: false, reason: "already running", attempts: row.attempts };
    }
    if (row.attempts >= MAX_INTERPRETATION_ATTEMPTS) {
      return { started: false, reason: "attempts exhausted", attempts: row.attempts };
    }
    await ctx.db.patch("interpretations", row._id, {
      status: "running",
      attempts: row.attempts + 1,
      lastAttemptAt: args.now,
    });
    return { started: true, attempts: row.attempts + 1 };
  },
});

/** Upgrade the generic event in place; user state and provenance untouched. */
async function applyInterpretationToEvent(
  ctx: MutationCtx,
  event: Doc<"events">,
  result: InterpretationResult,
  meta: { version: string; model?: string; provider?: string; interpretedAt: number },
): Promise<void> {
  const interpretation = {
    version: meta.version,
    provider: meta.provider,
    model: meta.model,
    interpretedAt: meta.interpretedAt,
    relevant: result.relevant,
    confidence: result.confidence,
    claimedSeverity: result.claimedSeverity,
    severityCapped: result.severityCapped,
    evidence: result.evidence,
    deadlineEvidence: result.deadlineEvidence,
    relevanceReason: result.relevanceReason,
    unsupportedClaims: result.unsupportedClaims,
    exposureOrigin: result.exposureOrigin,
    notes: result.notes,
  };

  if (!result.relevant) {
    // Keep the factual generic card; record the assessment for the detail view.
    await ctx.db.patch("events", event._id, {
      updatedAt: meta.interpretedAt,
      metadata: { ...event.metadata, interpreted: true, interpretation },
    });
    return;
  }

  await ctx.db.patch("events", event._id, {
    eventType: result.eventType,
    category: result.category,
    severity: result.severity,
    priorityScore: result.priorityScore,
    title: result.headline,
    summary: result.summary,
    whyItMatters: result.whyItMatters,
    recommendedAction: result.recommendedAction,
    requiresAction: result.requiresAction,
    deadline: result.deadline,
    confidence: result.confidence,
    updatedAt: meta.interpretedAt,
    // actionUrl deliberately untouched: it stays the trusted source URL.
    metadata: { ...event.metadata, interpreted: true, interpretation },
  });
  await syncTaskForEvent(ctx, event._id, meta.interpretedAt);
  const upgraded = await ctx.db.get("events", event._id);
  if (upgraded) await onEventChanged(ctx, upgraded, meta.interpretedAt);
}

export const recordSuccess = internalMutation({
  args: {
    interpretationId: v.id("interpretations"),
    result: interpretationResultValidator,
    provider: v.string(),
    model: v.string(),
    inputHash: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("interpretations", args.interpretationId);
    if (!row) return null;
    await ctx.db.patch("interpretations", row._id, {
      status: "ok",
      result: args.result,
      provider: args.provider,
      model: args.model,
      inputHash: args.inputHash,
      interpretedAt: args.now,
      errorKind: undefined,
      lastError: undefined,
    });
    const event = await ctx.db.get("events", row.eventId);
    if (event) {
      await applyInterpretationToEvent(ctx, event, args.result, {
        version: row.version,
        model: args.model,
        provider: args.provider,
        interpretedAt: args.now,
      });
    }
    return null;
  },
});

/** Output was schema-valid but failed Numa's local validation: never retried. */
export const recordRejection = internalMutation({
  args: { interpretationId: v.id("interpretations"), reason: v.string(), details: v.array(v.string()), provider: v.string(), model: v.string(), inputHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch("interpretations", args.interpretationId, {
      status: "rejected",
      provider: args.provider,
      model: args.model,
      inputHash: args.inputHash,
      interpretedAt: args.now,
      errorKind: "rejected",
      lastError: `${args.reason}: ${args.details.join("; ")}`.slice(0, 300),
    });
    const row = await ctx.db.get("interpretations", args.interpretationId);
    if (row) {
      const event = await ctx.db.get("events", row.eventId);
      if (event) {
        await ctx.db.patch("events", event._id, {
          metadata: { ...event.metadata, interpretationStatus: "rejected", interpretationReason: args.reason },
        });
      }
    }
    return null;
  },
});

export const recordFailure = internalMutation({
  args: { interpretationId: v.id("interpretations"), kind: v.string(), message: v.string(), now: v.number() },
  handler: async (ctx, args): Promise<{ attempts: number }> => {
    const row = await ctx.db.get("interpretations", args.interpretationId);
    if (!row) return { attempts: 0 };
    await ctx.db.patch("interpretations", row._id, {
      status: "failed",
      errorKind: args.kind,
      lastError: args.message.slice(0, 300),
      lastAttemptAt: args.now,
    });
    return { attempts: row.attempts };
  },
});

export const getForEvent = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("interpretations")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .unique();
  },
});
