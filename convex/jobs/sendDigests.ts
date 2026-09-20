/**
 * Daily brief scheduler (NUMA_ARCHITECTURE.md §8, §12): runs every 15
 * minutes and, for each user whose local time is inside their digest
 * window, generates and queues that day's brief. Idempotent through the
 * per-user/period brief and notification dedupe keys.
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { generateBriefForUser, queueDailyBrief } from "../briefs";
import { digestMinutes, localMinutes } from "../lib/localTime";

/** Cron cadence must be ≤ this window or a digest could be missed. */
const WINDOW_MINUTES = 30;

export const run = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ queued: number; skipped: number }> => {
    const now = args.now ?? Date.now();
    const prefs = await ctx.db.query("notificationPreferences").take(100);
    let queued = 0;
    let skipped = 0;
    for (const p of prefs) {
      if (!p.emailDigestEnabled) { skipped += 1; continue; }
      const minutes = localMinutes(now, p.timezone);
      const target = digestMinutes(p.digestTime);
      if (minutes < target || minutes >= target + WINDOW_MINUTES) { skipped += 1; continue; }
      const user = await ctx.db.get("users", p.userId);
      if (!user) { skipped += 1; continue; }
      const { brief } = await generateBriefForUser(ctx, user, now);
      const result = await queueDailyBrief(ctx, user, brief, now);
      if (result.created) queued += 1;
      else skipped += 1;
    }
    return { queued, skipped };
  },
});
