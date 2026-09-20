"use node";
/**
 * Official-source crawling (NUMA_ARCHITECTURE.md §13, §14):
 *
 *   load source → validate active → scrape (Firecrawl, network) →
 *   normalize → hash → compare with stored hash → persist →
 *   unchanged: stop · changed: raw change record → subscribed users' inboxes
 *
 * The only network call is the scrape. Everything else runs in internal
 * queries/mutations (convex/sources.ts). Crawled text is data: it is never
 * interpreted as instructions and nothing here executes anything from it.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { toProviderError, type ProviderErrorKind } from "../../lib/providers/errors";
import { normalizeContent } from "../../lib/web/normalizeContent";
import { hashContent } from "../../lib/web/hashContent";
import type { CrawlOutcome } from "../sources";
import { createWebSourceAdapter } from "./webAdapters";

export type CrawlResult =
  | ({ status: "ok"; sourceId: Id<"protocolSources">; provider: string; contentHash: string } & CrawlOutcome)
  | { status: "failed"; sourceId: Id<"protocolSources">; provider: string; error: string; kind: ProviderErrorKind; retryable: boolean }
  | { status: "skipped"; sourceId: Id<"protocolSources">; reason: string };

export async function performCrawl(
  ctx: ActionCtx,
  sourceId: Id<"protocolSources">,
  manual: boolean,
): Promise<CrawlResult> {
  const target = await ctx.runQuery(internal.sources.getForCrawl, { sourceId });
  if (!target) return { status: "skipped", sourceId, reason: "Source not found" };
  if (!target.source.isActive) return { status: "skipped", sourceId, reason: "Source is inactive" };

  const claim = await ctx.runMutation(internal.sources.markCrawlStarted, {
    sourceId,
    now: Date.now(),
    manual,
  });
  if (!claim.started) return { status: "skipped", sourceId, reason: claim.reason ?? "Skipped" };

  const adapter = createWebSourceAdapter();
  try {
    const scraped = await adapter.scrape({
      id: sourceId,
      url: target.source.url,
      sourceType: target.source.sourceType,
      protocolSlug: target.protocol.slug,
    });
    const normalized = normalizeContent(scraped.content);
    const contentHash = await hashContent(normalized);
    const outcome = await ctx.runMutation(internal.sources.recordCrawlResult, {
      sourceId,
      contentHash,
      normalizedContent: normalized,
      title: scraped.title,
      now: Date.now(),
    });
    return { status: "ok", sourceId, provider: adapter.provider, contentHash, ...outcome };
  } catch (error) {
    const providerError = toProviderError(error, adapter.provider);
    const message = `${adapter.provider}: ${providerError.message}`;
    console.error("source crawl failed", sourceId, providerError.kind, message);
    await ctx.runMutation(internal.sources.recordCrawlFailure, {
      sourceId,
      error: message,
      now: Date.now(),
    });
    return {
      status: "failed",
      sourceId,
      provider: adapter.provider,
      error: message,
      kind: providerError.kind,
      retryable: providerError.kind === "transient",
    };
  }
}

/** Scheduled crawl of one source (invoked by jobs/crawlSources). */
export const crawlProtocolSource = internalAction({
  args: { sourceId: v.id("protocolSources"), manual: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<CrawlResult> => {
    return await performCrawl(ctx, args.sourceId, args.manual ?? false);
  },
});

export type RefreshSummary = {
  checked: number;
  changed: number;
  unchanged: number;
  baseline: number;
  failed: number;
  skipped: number;
  results: CrawlResult[];
};

/**
 * User-triggered "Refresh monitored sources". Only registry sources are
 * crawled — no URL is accepted from the client — and each source honours a
 * cooldown so repeat clicks are cheap.
 */
export const refreshSources = action({
  args: {},
  handler: async (ctx): Promise<RefreshSummary> => {
    await ctx.runQuery(internal.sources.requireCallerForRefresh, {});
    await ctx.runMutation(internal.sources.seedSources, {});
    const sources = await ctx.runQuery(internal.sources.listActive, {});
    if (sources.length === 0) throw new ConvexError("No monitored sources are configured.");

    const summary: RefreshSummary = { checked: 0, changed: 0, unchanged: 0, baseline: 0, failed: 0, skipped: 0, results: [] };
    for (const source of sources) {
      const result = await performCrawl(ctx, source._id, true);
      summary.results.push(result);
      if (result.status === "skipped") summary.skipped += 1;
      else if (result.status === "failed") summary.failed += 1;
      else {
        summary.checked += 1;
        if (result.changed) summary.changed += 1;
        else if (result.baseline) summary.baseline += 1;
        else summary.unchanged += 1;
      }
    }
    return summary;
  },
});
