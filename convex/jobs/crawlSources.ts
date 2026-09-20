/**
 * Scheduled official-source recrawls (NUMA_ARCHITECTURE.md §8, §30, §42).
 *
 * Selects active sources that are due under their crawl policy, skips any
 * crawl still running, and schedules one crawl action per source with a
 * stagger so the provider is never hit in a burst. Idempotent: re-running
 * only schedules sources that are still due; each crawl is itself
 * idempotent (same content → no work).
 */
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { seedSourcesHelper } from "../sources";
import { isCrawlDue } from "../../lib/web/crawlPolicy";

const STAGGER_MS = 3_000;
const RUNNING_STALE_MS = 3 * 60_000;

export const run = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number; skipped: number }> => {
    // Self-healing registry: makes sure the official sources exist.
    await seedSourcesHelper(ctx);
    const now = Date.now();
    const active = await ctx.db
      .query("protocolSources")
      .withIndex("by_is_active", (q) => q.eq("isActive", true))
      .take(50);
    let scheduled = 0;
    let skipped = 0;
    for (const source of active) {
      const running =
        source.lastCrawlStatus === "running" &&
        now - (source.lastCrawlAttemptAt ?? 0) < RUNNING_STALE_MS;
      if (running || !isCrawlDue(source.crawlPolicy, source.lastCrawlAttemptAt, now)) {
        skipped += 1;
        continue;
      }
      await ctx.scheduler.runAfter(
        scheduled * STAGGER_MS,
        internal.ingestion.firecrawl.crawlProtocolSource,
        { sourceId: source._id },
      );
      scheduled += 1;
    }
    return { scheduled, skipped };
  },
});
