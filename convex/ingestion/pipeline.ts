/**
 * Ingestion pipeline (NUMA_ARCHITECTURE.md §0, §20):
 *
 *   raw source → rawEvent → normalize → relevance → priority
 *              → canonical event (upsert, deduped) → task → inbox
 *
 * Runs inside one mutation so a seed or scan is atomic. Every step is
 * idempotent: re-ingesting the same observation updates or no-ops.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { NumaEvent } from "../../lib/validation/events";
import { contentHash } from "../lib/hash";
import { normalizeRawEvent, type RawEventInput } from "../intelligence/normalize";
import { scorePriority } from "../intelligence/priority";
import { evaluateRelevance } from "../intelligence/relevance";
import { upsertNormalizedEventHelper, type UpsertOutcome } from "../events";
import { ensureProtocol } from "../protocols";
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
};

async function recordRawEvent(
  ctx: MutationCtx,
  raw: RawEventInput,
  walletId: Id<"wallets">,
  protocolId: Id<"protocols">,
): Promise<{ rawId: Id<"rawEvents">; repeated: boolean }> {
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
    return { rawId: existing._id, repeated: true };
  }

  const rawId = await ctx.db.insert("rawEvents", {
    source: raw.source,
    sourceEventId: raw.sourceEventId,
    walletId,
    protocolId,
    chainId: raw.payload.chainId,
    payload: raw.payload,
    observedAt: raw.observedAt,
    contentHash: hash,
    processingStatus: "pending",
  });
  return { rawId, repeated: false };
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

  for (const raw of rawEvents) {
    const protocolId = await ensureProtocol(ctx, raw.payload.protocol);
    const { rawId, repeated } = await recordRawEvent(
      ctx,
      raw,
      wallet._id,
      protocolId,
    );
    if (repeated) summary.rawRepeated += 1;
    else summary.rawRecorded += 1;

    const relevance = evaluateRelevance(raw, {
      walletId: wallet._id,
      walletAddress: wallet.address,
    });
    if (!relevance.relevant) {
      await ctx.db.patch("rawEvents", rawId, { processingStatus: "irrelevant" });
      summary.irrelevant += 1;
      continue;
    }

    let event: NumaEvent;
    try {
      const normalized = normalizeRawEvent(raw, {
        userId: user._id,
        walletId: wallet._id,
        walletAddress: wallet.address,
        protocolId,
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
      await ctx.db.patch("rawEvents", rawId, { processingStatus: "failed" });
      console.error("normalization failed", raw.sourceEventId, error);
      continue;
    }

    const result: UpsertOutcome = await upsertNormalizedEventHelper(
      ctx,
      event,
      now,
    );
    summary[result.outcome] += 1;
    summary.eventIds.push(result.eventId);

    await ctx.db.patch("rawEvents", rawId, {
      processingStatus: "normalized",
      eventId: result.eventId,
    });
    await syncTaskForEvent(ctx, result.eventId, now);
  }

  await ctx.db.patch("wallets", wallet._id, { lastScannedAt: now });
  return summary;
}
