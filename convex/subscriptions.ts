/**
 * Protocol subscriptions (NUMA_ARCHITECTURE.md §9, §12.2, §15): which
 * protocols a wallet is exposed to, derived only from evidence Numa already
 * holds — the wallet's own events. Live onchain observations produce
 * "live" subscriptions; fixture events produce "demo" ones, and the two are
 * never conflated. Subscriptions gate offchain source monitoring.
 */
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./lib/identity";
import type { SubscribedProtocol } from "./intelligence/relevance";

const EVIDENCE_PAGE = 500;

/** Event types that count as exposure evidence. Source updates never do
 *  (they are a *consequence* of a subscription, not evidence for one). */
function isExposureEvidence(event: Doc<"events">): boolean {
  return event.eventType !== "protocol_update" && event.protocolId !== undefined;
}

/**
 * Rebuild the wallet's subscriptions from its events. Idempotent: existing
 * rows are patched in place, nothing is duplicated, and a live observation
 * upgrades a demo-derived subscription.
 */
export async function syncSubscriptionsForWallet(
  ctx: MutationCtx,
  user: Doc<"users">,
  wallet: Doc<"wallets">,
  now: number,
): Promise<{ created: number; updated: number }> {
  const events = await ctx.db
    .query("events")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .take(EVIDENCE_PAGE);

  type Agg = { origin: "live" | "demo"; evidence: Set<string>; firstSeenAt: number; lastSeenAt: number };
  const byProtocol = new Map<Id<"protocols">, Agg>();
  for (const event of events) {
    if (event.walletId !== wallet._id || !isExposureEvidence(event)) continue;
    const protocolId = event.protocolId!;
    const origin: "live" | "demo" = event.isDemo ? "demo" : "live";
    const agg = byProtocol.get(protocolId) ?? {
      origin,
      evidence: new Set<string>(),
      firstSeenAt: event.detectedAt,
      lastSeenAt: event.updatedAt,
    };
    if (origin === "live") agg.origin = "live";
    agg.evidence.add(event.eventType);
    agg.firstSeenAt = Math.min(agg.firstSeenAt, event.detectedAt);
    agg.lastSeenAt = Math.max(agg.lastSeenAt, event.updatedAt);
    byProtocol.set(protocolId, agg);
  }

  let created = 0;
  let updated = 0;
  for (const [protocolId, agg] of byProtocol) {
    const evidence = Array.from(agg.evidence).sort();
    const confidence = agg.origin === "live" ? 1 : 0.5;
    const existing = await ctx.db
      .query("userProtocolSubscriptions")
      .withIndex("by_wallet_and_protocol", (q) =>
        q.eq("walletId", wallet._id).eq("protocolId", protocolId),
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("userProtocolSubscriptions", {
        userId: user._id,
        walletId: wallet._id,
        protocolId,
        firstSeenAt: agg.firstSeenAt,
        lastSeenAt: Math.max(agg.lastSeenAt, now),
        confidence,
        origin: agg.origin,
        evidence,
      });
      created += 1;
    } else if (
      existing.origin !== agg.origin ||
      existing.confidence !== confidence ||
      JSON.stringify(existing.evidence) !== JSON.stringify(evidence) ||
      existing.lastSeenAt < agg.lastSeenAt
    ) {
      await ctx.db.patch("userProtocolSubscriptions", existing._id, {
        origin: agg.origin,
        confidence,
        evidence,
        lastSeenAt: Math.max(existing.lastSeenAt, agg.lastSeenAt),
      });
      updated += 1;
    }
  }
  return { created, updated };
}

/** Subscribed protocol slugs for one wallet, for the relevance engine. */
export async function subscribedProtocolsForWallet(
  ctx: QueryCtx | MutationCtx,
  walletId: Id<"wallets">,
): Promise<SubscribedProtocol[]> {
  const rows = await ctx.db
    .query("userProtocolSubscriptions")
    .withIndex("by_wallet_and_protocol", (q) => q.eq("walletId", walletId))
    .take(50);
  const out: SubscribedProtocol[] = [];
  for (const row of rows) {
    const protocol = await ctx.db.get("protocols", row.protocolId);
    if (protocol) out.push({ slug: protocol.slug, origin: row.origin });
  }
  return out;
}

export const getSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("userProtocolSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(100);
    const out = [];
    for (const row of rows) {
      const protocol = await ctx.db.get("protocols", row.protocolId);
      if (!protocol) continue;
      out.push({
        _id: row._id,
        walletId: row.walletId,
        protocol: { _id: protocol._id, slug: protocol.slug, name: protocol.name },
        origin: row.origin,
        evidence: row.evidence,
        confidence: row.confidence,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
      });
    }
    return out.sort((a, b) =>
      a.origin !== b.origin ? (a.origin === "live" ? -1 : 1) : a.protocol.name.localeCompare(b.protocol.name),
    );
  },
});
