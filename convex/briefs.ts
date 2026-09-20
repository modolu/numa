/**
 * Daily briefs (NUMA_ARCHITECTURE.md §4.3, §23): generated deterministically
 * from canonical events, persisted per user and local date, and delivered
 * through the notification queue. `sendDigest(userId, period)` is idempotent.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { buildBrief } from "../lib/notifications/brief";
import { getCurrentUser, requireUser } from "./lib/identity";
import { localDate } from "./lib/localTime";
import { resolveRecipient } from "./lib/recipient";
import { getPreferencesFor, queueNotification, scheduleSend, TEST_SEND_COOLDOWN_MS } from "./notifications";

const EVENT_PAGE = 300;

export async function generateBriefForUser(
  ctx: MutationCtx,
  user: Doc<"users">,
  now: number,
  options: { force?: boolean } = {},
): Promise<{ brief: Doc<"briefs">; created: boolean }> {
  const prefs = await getPreferencesFor(ctx, user._id);
  const period = localDate(now, prefs.timezone);
  const existing = await ctx.db
    .query("briefs")
    .withIndex("by_user_and_period", (q) => q.eq("userId", user._id).eq("period", period))
    .unique();
  if (existing && !options.force) return { brief: existing, created: false };

  const events = await ctx.db.query("events").withIndex("by_user", (q) => q.eq("userId", user._id)).take(EVENT_PAGE);
  const content = buildBrief(events);
  const fields = {
    generatedAt: now,
    headline: content.headline,
    summary: content.summary,
    eventIds: content.items.map((i) => i.eventId),
    items: content.items,
    remaining: content.remaining,
  };
  if (existing) {
    await ctx.db.patch("briefs", existing._id, fields);
    return { brief: (await ctx.db.get("briefs", existing._id))!, created: true };
  }
  const briefId = await ctx.db.insert("briefs", { userId: user._id, period, ...fields, sentViaEmail: false });
  return { brief: (await ctx.db.get("briefs", briefId))!, created: true };
}

/** Queue the daily brief email once per user/period and hand it to the sender. */
export async function queueDailyBrief(
  ctx: MutationCtx,
  user: Doc<"users">,
  brief: Doc<"briefs">,
  now: number,
): Promise<{ notificationId: Id<"notifications">; created: boolean }> {
  const recipient = resolveRecipient(user);
  const result = await queueNotification(ctx, {
    userId: user._id,
    type: "daily_brief",
    dedupeKey: `daily_brief|${user._id}|${brief.period}`,
    recipientMasked: recipient.configured ? recipient.masked : "***",
    briefId: brief._id,
    now,
  });
  if (result.created) {
    await ctx.db.patch("briefs", brief._id, { notificationId: result.notificationId });
    await scheduleSend(ctx, result.notificationId);
  }
  return result;
}

/** Idempotent digest for one user and local date (scheduler entry point). */
export const sendDigest = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ briefId: Id<"briefs">; queued: boolean }> => {
    const user = await ctx.db.get("users", args.userId);
    if (!user) throw new Error("User not found");
    const now = Date.now();
    const { brief } = await generateBriefForUser(ctx, user, now);
    const result = await queueDailyBrief(ctx, user, brief, now);
    return { briefId: brief._id, queued: result.created };
  },
});

export const getTodayBrief = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const prefs = await getPreferencesFor(ctx, user._id);
    const period = localDate(args.now, prefs.timezone);
    const brief = await ctx.db
      .query("briefs")
      .withIndex("by_user_and_period", (q) => q.eq("userId", user._id).eq("period", period))
      .unique();
    if (!brief) return { period, brief: null, notification: null };
    const notification = brief.notificationId ? await ctx.db.get("notifications", brief.notificationId) : null;
    return {
      period,
      brief,
      notification: notification
        ? { status: notification.status, sentAt: notification.sentAt, attempts: notification.attempts, failureKind: notification.failureKind, failureReason: notification.failureReason, isTest: notification.isTest ?? false }
        : null,
    };
  },
});

/** Development-safe: build (or rebuild) today's brief without sending. */
export const generateBrief = mutation({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const { brief, created } = await generateBriefForUser(ctx, user, Date.now(), { force: args.force ?? false });
    return { briefId: brief._id, created, itemCount: brief.items.length };
  },
});

/**
 * Development-safe test send: today's brief to the configured recipient only,
 * clearly labelled as a test, rate-limited. Used by the `sendTestBrief` action.
 */
export const prepareTestBrief = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ notificationId: Id<"notifications"> }> => {
    const user = await requireUser(ctx);
    const recipient = resolveRecipient(user);
    if (!recipient.configured) throw new ConvexError(recipient.reason);
    const now = Date.now();
    const recent = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(10);
    const lastTest = recent.find((n) => n.type === "test_brief");
    if (lastTest && now - lastTest.createdAt < TEST_SEND_COOLDOWN_MS) {
      throw new ConvexError("A test brief was sent a moment ago — try again in a minute.");
    }
    const { brief } = await generateBriefForUser(ctx, user, now);
    const result = await queueNotification(ctx, {
      userId: user._id,
      type: "test_brief",
      dedupeKey: `test_brief|${user._id}|${Math.floor(now / TEST_SEND_COOLDOWN_MS)}`,
      recipientMasked: recipient.masked,
      briefId: brief._id,
      isTest: true,
      now,
    });
    if (!result.created) throw new ConvexError("A test brief is already in progress.");
    return { notificationId: result.notificationId };
  },
});
