/**
 * Scheduled wallet rescans (NUMA_ARCHITECTURE.md §8 cron jobs, §30).
 *
 * Finds monitored wallets that have not been attempted recently and
 * schedules one scan action per wallet with a small stagger so a public RPC
 * is never hit in a burst. Idempotent: re-running only schedules wallets
 * that are still due, and each scan is itself idempotent.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

/** Do not re-attempt a wallet more often than this from the scheduler. */
export const SCHEDULED_SCAN_MIN_GAP_MS = 60 * 60_000;
const BATCH = 100;
const STAGGER_MS = 2_000;

export const run = internalMutation({
  args: { minGapMs: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ scheduled: number; skipped: number }> => {
    const now = Date.now();
    const minGap = args.minGapMs ?? SCHEDULED_SCAN_MIN_GAP_MS;
    const wallets = await ctx.db.query("wallets").take(BATCH);
    let scheduled = 0;
    let skipped = 0;
    for (const wallet of wallets) {
      const attempt = wallet.lastScanAttemptAt ?? 0;
      if (now - attempt < minGap) {
        skipped += 1;
        continue;
      }
      await ctx.scheduler.runAfter(
        scheduled * STAGGER_MS,
        internal.ingestion.wallet.runScheduledScan,
        { walletId: wallet._id },
      );
      scheduled += 1;
    }
    return { scheduled, skipped };
  },
});
