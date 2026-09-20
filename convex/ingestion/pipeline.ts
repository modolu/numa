/**
 * Ingestion pipeline (NUMA_ARCHITECTURE.md §0, §20):
 *
 *   raw source → rawEvent → normalize → relevance → priority
 *              → canonical event (upsert, deduped) → task → inbox
 *
 * Two entry points share one promotion path:
 *   - `ingestRawEvents`        wallet-scoped observations (scans, fixtures);
 *   - `processRawEventForUser` one already-recorded raw event for one user
 *                              (offchain source changes fanned out through
 *                              protocol subscriptions).
 * Every step is idempotent: re-ingesting the same observation updates or
 * no-ops, and user state on existing events is never touched.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { NumaEvent } from "../../lib/validation/events";
import type { RawEventInput } from "../../lib/events/raw";
import { contentHash } from "../lib/hash";
import { normalizeRawEvent } from "../intelligence/normalize";
import { scorePriority } from "../intelligence/priority";
import { evaluateRelevance, type SubscribedProtocol } from "../intelligence/relevance";
import { upsertNormalizedEventHelper, type UpsertOutcome } from "../events";
import { ensureProtocol } from "../protocols";
import { subscribedProtocolsForWallet, syncSubscriptionsForWallet } from "../subscriptions";
import { syncTaskForEvent } from "../tasks";

export type IngestSummary = {
  received: number;
  rawRecorded: number;
  rawRepeated: number;
  irrelevant: number;
  created: number;
  updated: number;
  unchanged: number;
  eventIds: Id<"events">[];
};

export type IngestInput = {
  user: Doc<"users">;
  wallet: Doc<"wallets">;
  rawEvents: RawEventInput[];
  now: number;
  /** Stamp `wallets.lastScannedAt` (wallet scans); off for offchain fan-out. */
  touchWalletScan?: boolean;
};

export type RecordRawResult = {
  rawId: Id<"rawEvents">;
  repeated: boolean;
  /** First time this observation was recorded (stable across retries). */
  observedAt: number;
};

/** Persist (or refresh) a raw observation keyed by source + sourceEventId. */
export async function recordRawEvent(
  ctx: MutationCtx,
  raw: RawEventInput,
  ids: { walletId?: Id<"wallets">; protocolId: Id<"protocols"> },
): Promise<RecordRawResult> {
  const hash = contentHash(raw.payload);
  const existing = await ctx.db
    .query("rawEvents")
    .withIndex("by_source_and_source_event_id", (q) =>
      q.eq("source", raw.source).eq("sourceEventId", raw.sourceEventId),
    )
    .unique();

  if (existing) {
    if (existing.contentHash !== hash) {
      await ctx.db.patch("rawEvents", existing._id, {
        payload: raw.payload,
        contentHash: hash,
        observedAt: raw.observedAt,
        processingStatus: "pending",
      });
    }
    return { rawId: existing._id, repeated: true, observedAt: existing.observedAt };
  }

  const rawId = await ctx.db.insert("rawEvents", {
    source: raw.source,
    sourceEventId: raw.sourceEventId,
    walletId: ids.walletId,
    protocolId: ids.protocolId,
    chainId: raw.payload.chainId,
    payload: raw.payload,
    observedAt: raw.observedAt,
    contentHash: hash,
    processingStatus: "pending",
  });
  return { rawId, repeated: false, observedAt: raw.observedAt };
}

export type ProcessInput = {
  rawId: Id<"rawEvents">;
  raw: RawEventInput;
  user: Doc<"users">;
  wallet: Doc<"wallets">;
  protocolId: Id<"protocols">;
  protocolName?: string;
  subscriptions: SubscribedProtocol[];
  now: number;
};

export type ProcessOutcome =
  | { kind: "irrelevant"; reason: string }
  | { kind: "failed" }
  | ({ kind: "promoted" } & UpsertOutcome);

/**
 * relevance → normalize → priority → upsert → task for one raw observation
 * and one user/wallet. Does not update the raw row's processing status;
 * callers own that because one raw row may serve many users.
 */
export async function processRawEventForUser(
  ctx: MutationCtx,
  input: ProcessInput,
): Promise<ProcessOutcome> {
  const { raw, user, wallet, protocolId, now } = input;

  const relevance = evaluateRelevance(raw, {
    walletId: wallet._id,
    walletAddress: wallet.address,
    subscriptions: input.subscriptions,
  });
  if (!relevance.relevant) {
    return { kind: "irrelevant", reason: relevance.reason };
  }

  const subscription = input.subscriptions.find((s) => s.slug === raw.payload.protocol);

  let event: NumaEvent;
  try {
    const normalized = normalizeRawEvent(raw, {
      userId: user._id,
      walletId: wallet._id,
      walletAddress: wallet.address,
      protocolId,
      protocolName: input.protocolName,
      exposureOrigin: subscription?.origin,
      now,
    });
    const { priorityFactors, ...candidate } = normalized;
    const priority = scorePriority(priorityFactors);
    event = {
      ...candidate,
      severity: priority.severity,
      priorityScore: priority.score,
      // Keep the factors on the event so the ranking stays inspectable.
      metadata: {
        ...candidate.metadata,
        priorityFactors: priority.factors,
        relevanceReason: relevance.reason,
        relevanceConfidence: relevance.confidence,
      },
    };
  } catch (error) {
    console.error("normalization failed", raw.sourceEventId, error);
    return { kind: "failed" };
  }

  const result = await upsertNormalizedEventHelper(ctx, event, now);
  await syncTaskForEvent(ctx, result.eventId, now);
  return { kind: "promoted", ...result };
}

export async function ingestRawEvents(
  ctx: MutationCtx,
  input: IngestInput,
): Promise<IngestSummary> {
  const { user, wallet, rawEvents, now } = input;
  const summary: IngestSummary = {
    received: rawEvents.length,
    rawRecorded: 0,
    rawRepeated: 0,
    irrelevant: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    eventIds: [],
  };
  const subscriptions = await subscribedProtocolsForWallet(ctx, wallet._id);

  for (const raw of rawEvents) {
    const protocolId = await ensureProtocol(ctx, raw.payload.protocol);
    const protocol = await ctx.db.get("protocols", protocolId);
    const { rawId, repeated } = await recordRawEvent(ctx, raw, { walletId: wallet._id, protocolId });
    if (repeated) summary.rawRepeated += 1;
    else summary.rawRecorded += 1;

    const outcome = await processRawEventForUser(ctx, {
      rawId,
      raw,
      user,
      wallet,
      protocolId,
      protocolName: protocol?.name,
      subscriptions,
      now,
    });

    if (outcome.kind === "irrelevant") {
      await ctx.db.patch("rawEvents", rawId, { processingStatus: "irrelevant" });
      summary.irrelevant += 1;
      continue;
    }
    if (outcome.kind === "failed") {
      await ctx.db.patch("rawEvents", rawId, { processingStatus: "failed" });
      continue;
    }
    summary[outcome.outcome] += 1;
    summary.eventIds.push(outcome.eventId);
    await ctx.db.patch("rawEvents", rawId, {
      processingStatus: "normalized",
      eventId: outcome.eventId,
    });
  }

  // New observations may establish or upgrade protocol exposure.
  await syncSubscriptionsForWallet(ctx, user, wallet, now);

  if (input.touchWalletScan !== false) {
    await ctx.db.patch("wallets", wallet._id, { lastScannedAt: now });
  }
  return summary;
}
