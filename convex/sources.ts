/**
 * Official protocol sources (NUMA_ARCHITECTURE.md §2.3, §9, §13, §14).
 *
 * The registry below is the only way a URL enters `protocolSources`; every
 * entry is validated against the protocol's official hosts. Crawl results
 * are persisted here: Numa keeps its own normalized-content hash per source
 * and decides itself whether a page changed. A change becomes an auditable
 * `rawEvents` row and is fanned out to subscribed users through the shared
 * pipeline; unchanged pages only refresh crawl health.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type { ProtocolSourceType, ProtocolUpdatePayload, RawEventInput } from "../lib/events/raw";
import { validateOfficialSource } from "../lib/web/sources";
import { boundContent, excerptOf } from "../lib/web/normalizeContent";
import { isCrawlDue, type CrawlPolicy } from "../lib/web/crawlPolicy";
import { getCurrentUser } from "./lib/identity";
import { knownProtocol, officialHostsFor, seedProtocolsHelper } from "./protocols";
import { processRawEventForUser, recordRawEvent } from "./ingestion/pipeline";
import { ensureInterpretationScheduled } from "./interpretations";

export const FIRECRAWL_SOURCE = "firecrawl";
/** A crawl still marked running after this long is treated as abandoned. */
const RUNNING_STALE_MS = 3 * 60_000;
/** Minimum gap between manual refreshes of one source. */
export const MANUAL_CRAWL_COOLDOWN_MS = 60_000;
const FANOUT_PAGE = 200;

export type OfficialSource = {
  protocolSlug: string;
  url: string;
  sourceType: ProtocolSourceType;
  crawlPolicy: CrawlPolicy;
};

/** Deliberately small: prove the architecture, don't crawl the internet. */
export const OFFICIAL_SOURCES: readonly OfficialSource[] = [
  { protocolSlug: "aave", url: "https://governance.aave.com/", sourceType: "governance", crawlPolicy: "governance" },
  { protocolSlug: "aave", url: "https://aave.com/blog", sourceType: "blog", crawlPolicy: "updates" },
  { protocolSlug: "arbitrum-dao", url: "https://forum.arbitrum.foundation/", sourceType: "governance", crawlPolicy: "governance" },
  { protocolSlug: "arbitrum-bridge", url: "https://docs.arbitrum.io/", sourceType: "docs", crawlPolicy: "docs" },
  { protocolSlug: "ens", url: "https://docs.ens.domains/", sourceType: "docs", crawlPolicy: "docs" },
  { protocolSlug: "ens", url: "https://ens.domains/blog", sourceType: "blog", crawlPolicy: "updates" },
];

// ---------------------------------------------------------------------------
// Seeding (idempotent)
// ---------------------------------------------------------------------------

export async function seedSourcesHelper(
  ctx: MutationCtx,
): Promise<{ inserted: number; unchanged: number; rejected: { url: string; reason: string }[] }> {
  await seedProtocolsHelper(ctx);
  let inserted = 0;
  let unchanged = 0;
  const rejected: { url: string; reason: string }[] = [];

  for (const entry of OFFICIAL_SOURCES) {
    const protocol = await ctx.db
      .query("protocols")
      .withIndex("by_slug", (q) => q.eq("slug", entry.protocolSlug))
      .unique();
    const hosts = protocol ? officialHostsFor(protocol) : (knownProtocol(entry.protocolSlug)?.officialHosts ?? []);
    const validation = validateOfficialSource(entry, hosts);
    if (!protocol) {
      rejected.push({ url: entry.url, reason: "Unknown protocol" });
      continue;
    }
    if (!validation.ok) {
      rejected.push({ url: entry.url, reason: validation.reason });
      continue;
    }
    const existing = await ctx.db
      .query("protocolSources")
      .withIndex("by_url", (q) => q.eq("url", validation.url))
      .unique();
    if (existing) {
      if (
        existing.sourceType !== entry.sourceType ||
        existing.crawlPolicy !== entry.crawlPolicy ||
        existing.protocolId !== protocol._id
      ) {
        await ctx.db.patch("protocolSources", existing._id, {
          sourceType: entry.sourceType,
          crawlPolicy: entry.crawlPolicy,
          protocolId: protocol._id,
        });
      }
      unchanged += 1;
      continue;
    }
    await ctx.db.insert("protocolSources", {
      protocolId: protocol._id,
      sourceType: entry.sourceType,
      url: validation.url,
      crawlPolicy: entry.crawlPolicy,
      isActive: true,
    });
    inserted += 1;
  }
  return { inserted, unchanged, rejected };
}

export const seedSources = internalMutation({
  args: {},
  handler: async (ctx) => await seedSourcesHelper(ctx),
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type CrawlTarget = {
  source: Doc<"protocolSources">;
  protocol: Doc<"protocols">;
};

export const getForCrawl = internalQuery({
  args: { sourceId: v.id("protocolSources") },
  handler: async (ctx, args): Promise<CrawlTarget | null> => {
    const source = await ctx.db.get("protocolSources", args.sourceId);
    if (!source) return null;
    const protocol = await ctx.db.get("protocols", source.protocolId);
    if (!protocol) return null;
    return { source, protocol };
  },
});

export const listActive = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"protocolSources">[]> => {
    return await ctx.db
      .query("protocolSources")
      .withIndex("by_is_active", (q) => q.eq("isActive", true))
      .take(50);
  },
});

/** Sources due under their crawl policy (used by the scheduler). */
export const listDue = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args): Promise<Id<"protocolSources">[]> => {
    const active = await ctx.db
      .query("protocolSources")
      .withIndex("by_is_active", (q) => q.eq("isActive", true))
      .take(50);
    return active
      .filter((s) => {
        if (s.lastCrawlStatus === "running" && args.now - (s.lastCrawlAttemptAt ?? 0) < RUNNING_STALE_MS) {
          return false;
        }
        return isCrawlDue(s.crawlPolicy, s.lastCrawlAttemptAt, args.now);
      })
      .map((s) => s._id);
  },
});

/** Monitored sources with health, for the Settings panel. No content. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const sources = await ctx.db.query("protocolSources").take(50);
    const out = [];
    for (const s of sources) {
      const protocol = await ctx.db.get("protocols", s.protocolId);
      out.push({
        _id: s._id,
        url: s.url,
        sourceType: s.sourceType,
        crawlPolicy: s.crawlPolicy,
        isActive: s.isActive,
        protocol: protocol ? { slug: protocol.slug, name: protocol.name } : null,
        lastCrawledAt: s.lastCrawledAt,
        lastCrawlAttemptAt: s.lastCrawlAttemptAt,
        lastCrawlStatus: s.lastCrawlStatus,
        lastCrawlError: s.lastCrawlError,
        lastChangedAt: s.lastChangedAt,
        contentHash: s.contentHash ? s.contentHash.slice(0, 12) : undefined,
        latestTitle: s.latestTitle,
      });
    }
    return out.sort((a, b) =>
      (a.protocol?.name ?? "").localeCompare(b.protocol?.name ?? "") || a.url.localeCompare(b.url),
    );
  },
});

// ---------------------------------------------------------------------------
// Crawl persistence
// ---------------------------------------------------------------------------

export const markCrawlStarted = internalMutation({
  args: { sourceId: v.id("protocolSources"), now: v.number(), manual: v.boolean() },
  handler: async (ctx, args): Promise<{ started: boolean; reason?: string }> => {
    const source = await ctx.db.get("protocolSources", args.sourceId);
    if (!source) return { started: false, reason: "Source not found" };
    if (!source.isActive) return { started: false, reason: "Source is inactive" };
    const attempt = source.lastCrawlAttemptAt ?? 0;
    if (source.lastCrawlStatus === "running" && args.now - attempt < RUNNING_STALE_MS) {
      return { started: false, reason: "A crawl is already running" };
    }
    if (args.manual && args.now - attempt < MANUAL_CRAWL_COOLDOWN_MS) {
      return { started: false, reason: "Checked a moment ago" };
    }
    await ctx.db.patch("protocolSources", source._id, {
      lastCrawlAttemptAt: args.now,
      lastCrawlStatus: "running",
    });
    return { started: true };
  },
});

export type CrawlOutcome =
  | { changed: false; baseline: boolean }
  | {
      changed: true;
      rawEventId: Id<"rawEvents">;
      fanout: {
        users: number;
        promoted: number;
        created: number;
        updated: number;
        unchanged: number;
        irrelevant: number;
        interpretationsScheduled: number;
      };
    };

/**
 * Compare the freshly hashed content with the stored hash and persist.
 * Unchanged → health only. First observation → baseline (no change event:
 * nothing to compare against yet). Changed → snapshot + raw change record +
 * fan-out to every wallet subscribed to the protocol.
 */
export const recordCrawlResult = internalMutation({
  args: {
    sourceId: v.id("protocolSources"),
    contentHash: v.string(),
    normalizedContent: v.string(),
    title: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<CrawlOutcome> => {
    const source = await ctx.db.get("protocolSources", args.sourceId);
    if (!source) throw new Error("Source not found");
    const protocol = await ctx.db.get("protocols", source.protocolId);
    if (!protocol) throw new Error("Protocol not found");

    const health = {
      lastCrawledAt: args.now,
      lastCrawlStatus: "ok" as const,
      lastCrawlError: undefined,
    };

    if (source.contentHash === args.contentHash) {
      await ctx.db.patch("protocolSources", source._id, health);
      return { changed: false, baseline: false };
    }

    const previousHash = source.contentHash;
    await ctx.db.patch("protocolSources", source._id, {
      ...health,
      previousContentHash: previousHash,
      contentHash: args.contentHash,
      latestContent: boundContent(args.normalizedContent),
      latestTitle: args.title,
      latestContentLength: args.normalizedContent.length,
      lastChangedAt: previousHash === undefined ? undefined : args.now,
    });

    if (previousHash === undefined) {
      return { changed: false, baseline: true };
    }

    const payload: ProtocolUpdatePayload = {
      kind: "protocol_update",
      protocol: protocol.slug,
      sourceId: source._id,
      sourceUrl: source.url,
      sourceType: source.sourceType,
      previousHash,
      currentHash: args.contentHash,
      title: args.title,
      excerpt: excerptOf(args.normalizedContent),
      contentLength: args.normalizedContent.length,
    };
    const raw: RawEventInput = {
      source: FIRECRAWL_SOURCE,
      sourceEventId: `${FIRECRAWL_SOURCE}:${source._id}:${args.contentHash}`,
      observedAt: args.now,
      payload,
      isDemo: false,
    };
    const recorded = await recordRawEvent(ctx, raw, { protocolId: protocol._id });
    const rawId = recorded.rawId;
    // On a retry of the same content version, keep the first observation time
    // so the canonical event is byte-identical and user state is untouched.
    const rawForUsers: RawEventInput = { ...raw, observedAt: recorded.observedAt };

    // Relevance prefilter: only wallets subscribed to this protocol.
    const subscriptions = await ctx.db
      .query("userProtocolSubscriptions")
      .withIndex("by_protocol", (q) => q.eq("protocolId", protocol._id))
      .take(FANOUT_PAGE);
    // One event per user; prefer a live-derived subscription when several wallets qualify.
    const byUser = new Map<Id<"users">, Doc<"userProtocolSubscriptions">>();
    for (const sub of subscriptions) {
      const current = byUser.get(sub.userId);
      if (!current || (current.origin === "demo" && sub.origin === "live")) byUser.set(sub.userId, sub);
    }

    const fanout = { users: byUser.size, promoted: 0, created: 0, updated: 0, unchanged: 0, irrelevant: 0, interpretationsScheduled: 0 };
    for (const sub of byUser.values()) {
      const [user, wallet] = await Promise.all([
        ctx.db.get("users", sub.userId),
        ctx.db.get("wallets", sub.walletId),
      ]);
      if (!user || !wallet) continue;
      const outcome = await processRawEventForUser(ctx, {
        rawId,
        raw: rawForUsers,
        user,
        wallet,
        protocolId: protocol._id,
        protocolName: protocol.name,
        subscriptions: [{ slug: protocol.slug, origin: sub.origin }],
        now: args.now,
      });
      if (outcome.kind === "promoted") {
        fanout.promoted += 1;
        fanout[outcome.outcome] += 1;
        // Semantic interpretation runs asynchronously; the generic card is
        // already in the inbox and stays as the fallback (§16).
        const scheduled = await ensureInterpretationScheduled(ctx, {
          sourceId: source._id,
          contentHash: args.contentHash,
          userId: user._id,
          walletId: wallet._id,
          eventId: outcome.eventId,
          now: args.now,
        });
        if (scheduled.scheduled) fanout.interpretationsScheduled += 1;
      } else if (outcome.kind === "irrelevant") {
        fanout.irrelevant += 1;
      }
    }
    await ctx.db.patch("rawEvents", rawId, {
      processingStatus: fanout.promoted > 0 ? "normalized" : "irrelevant",
    });
    return { changed: true, rawEventId: rawId, fanout };
  },
});

/** Record a provider failure; content, hash and last success stay intact. */
export const recordCrawlFailure = internalMutation({
  args: { sourceId: v.id("protocolSources"), error: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const source = await ctx.db.get("protocolSources", args.sourceId);
    if (!source) return null;
    await ctx.db.patch("protocolSources", source._id, {
      lastCrawlAttemptAt: args.now,
      lastCrawlStatus: "failed",
      lastCrawlError: args.error.slice(0, 300),
    });
    return null;
  },
});

/** Ownership-free identity check for the manual refresh action. */
export const requireCallerForRefresh = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new ConvexError("Add a wallet before refreshing sources.");
    return { userId: user._id };
  },
});

/**
 * DEVELOPMENT ONLY (internal, CLI/dashboard): make the next crawl of a source
 * register as changed even if the page did not change, by replacing the
 * stored hash with a clearly labelled marker. Used to exercise the
 * change → interpretation path against real official content without
 * pretending a protocol incident happened.
 */
export const devForceRecrawl = internalMutation({
  args: { sourceId: v.id("protocolSources") },
  handler: async (ctx, args) => {
    const source = await ctx.db.get("protocolSources", args.sourceId);
    if (!source || !source.contentHash) throw new Error("Source has no baseline yet");
    await ctx.db.patch("protocolSources", source._id, {
      contentHash: `dev-forced-rebaseline-${Date.now()}`,
      lastCrawlAttemptAt: undefined,
    });
    return { previousHash: source.contentHash };
  },
});
