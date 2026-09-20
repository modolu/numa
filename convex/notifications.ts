/**
 * Outbound notifications (NUMA_ARCHITECTURE.md §22, §29, §30):
 * preferences, idempotent queueing, urgent-alert gating with escalation,
 * deadline reminders reconciled through the Convex scheduler, and the
 * persisted send lifecycle. No network calls here — the AgentMail send
 * runs in convex/ingestion/mail.ts.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { SEVERITY_RANK, type EventSeverity } from "../lib/validation/events";
import { getCurrentUser, requireUser } from "./lib/identity";
import { resolveRecipient, type RecipientResolution } from "./lib/recipient";
import { isValidDigestTime, isValidTimezone } from "./lib/localTime";
import { eventSeverityValidator } from "./lib/validators";

const HOUR = 3_600_000;
export const MAX_SEND_ATTEMPTS = 4;
/** attempt 1 now · 2 +30s · 3 +2m · 4 +10m · stop (§29). */
export const SEND_RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const;
export const TEST_SEND_COOLDOWN_MS = 60_000;
/** Generic info/low items never page anyone, whatever the preference says. */
export const URGENT_SEVERITY_FLOOR: EventSeverity = "medium";
export const REMINDER_OFFSETS = [
  { label: "24h", ms: 24 * HOUR },
  { label: "1h", ms: HOUR },
] as const;
/**
 * Reminders are only placed on the scheduler once they are within this
 * horizon (Convex refuses schedules years out, and distant deadlines change).
 * `reconcileDueReminders` runs periodically to pick up deadlines as they
 * come into range.
 */
export const REMINDER_SCHEDULE_HORIZON_MS = 30 * 24 * HOUR;

export type Preferences = Omit<Doc<"notificationPreferences">, "_id" | "_creationTime" | "userId" | "updatedAt">;

export const DEFAULT_PREFERENCES: Preferences = {
  emailDigestEnabled: true,
  urgentEmailEnabled: true,
  digestTime: "08:00",
  timezone: "UTC",
  minimumEmailSeverity: "high",
};

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function getPreferencesFor(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Preferences> {
  const row = await ctx.db
    .query("notificationPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return row ?? DEFAULT_PREFERENCES;
}

export const getPreferences = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const prefs = await getPreferencesFor(ctx, user._id);
    const recipient = resolveRecipient(user);
    return {
      ...prefs,
      recipient: recipient.configured
        ? { configured: true as const, masked: recipient.masked, source: recipient.source }
        : { configured: false as const, reason: recipient.reason },
      senderConfigured: Boolean(process.env.AGENTMAIL_API_KEY && process.env.AGENTMAIL_INBOX_ID),
    };
  },
});

export const setPreferences = mutation({
  args: {
    emailDigestEnabled: v.optional(v.boolean()),
    urgentEmailEnabled: v.optional(v.boolean()),
    digestTime: v.optional(v.string()),
    timezone: v.optional(v.string()),
    minimumEmailSeverity: v.optional(eventSeverityValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.digestTime !== undefined && !isValidDigestTime(args.digestTime)) {
      throw new ConvexError("Digest time must be HH:MM (24-hour).");
    }
    if (args.timezone !== undefined && !isValidTimezone(args.timezone)) {
      throw new ConvexError("Unknown timezone.");
    }
    const current = await getPreferencesFor(ctx, user._id);
    const next: Preferences = {
      emailDigestEnabled: args.emailDigestEnabled ?? current.emailDigestEnabled,
      urgentEmailEnabled: args.urgentEmailEnabled ?? current.urgentEmailEnabled,
      digestTime: args.digestTime ?? current.digestTime,
      timezone: args.timezone ?? current.timezone,
      minimumEmailSeverity: args.minimumEmailSeverity ?? current.minimumEmailSeverity,
    };
    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (existing) await ctx.db.patch("notificationPreferences", existing._id, { ...next, updatedAt: Date.now() });
    else await ctx.db.insert("notificationPreferences", { userId: user._id, ...next, updatedAt: Date.now() });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Queueing (idempotent by dedupe key)
// ---------------------------------------------------------------------------

export type QueueArgs = {
  userId: Id<"users">;
  type: Doc<"notifications">["type"];
  dedupeKey: string;
  recipientMasked: string;
  eventId?: Id<"events">;
  briefId?: Id<"briefs">;
  subject?: string;
  notifiedSeverity?: EventSeverity;
  reminderOffset?: string;
  scheduledFor?: number;
  isTest?: boolean;
  now: number;
};

const ACTIVE_STATUSES: ReadonlySet<Doc<"notifications">["status"]> = new Set([
  "queued", "sending", "sent", "delivered", "complained",
]);

/**
 * Create the notification unless one with the same logical identity already
 * exists. A cancelled row can be re-armed; a sent/failed row is final.
 */
export async function queueNotification(
  ctx: MutationCtx,
  args: QueueArgs,
): Promise<{ notificationId: Id<"notifications">; created: boolean; existingStatus?: Doc<"notifications">["status"] }> {
  const existing = await ctx.db
    .query("notifications")
    .withIndex("by_dedupe_key", (q) => q.eq("dedupeKey", args.dedupeKey))
    .unique();
  if (existing) {
    if (existing.status === "cancelled") {
      await ctx.db.patch("notifications", existing._id, {
        status: "queued",
        scheduledFor: args.scheduledFor,
        scheduledFunctionId: undefined,
        attempts: 0,
        failureKind: undefined,
        failureReason: undefined,
      });
      return { notificationId: existing._id, created: true };
    }
    return { notificationId: existing._id, created: false, existingStatus: existing.status };
  }
  const notificationId = await ctx.db.insert("notifications", {
    userId: args.userId,
    eventId: args.eventId,
    briefId: args.briefId,
    type: args.type,
    recipient: args.recipientMasked,
    subject: args.subject,
    status: "queued",
    dedupeKey: args.dedupeKey,
    attempts: 0,
    createdAt: args.now,
    scheduledFor: args.scheduledFor,
    reminderOffset: args.reminderOffset,
    notifiedSeverity: args.notifiedSeverity,
    isTest: args.isTest,
  });
  return { notificationId, created: true };
}

export async function scheduleSend(ctx: MutationCtx, notificationId: Id<"notifications">, delayMs = 0): Promise<void> {
  await ctx.scheduler.runAfter(delayMs, internal.ingestion.mail.sendNotification, { notificationId });
}

// ---------------------------------------------------------------------------
// Urgent alerts (§9, §10)
// ---------------------------------------------------------------------------

export type UrgentDecision = { eligible: true } | { eligible: false; reason: string };

export function isUrgentEligible(event: Doc<"events">, prefs: Preferences): UrgentDecision {
  if (!prefs.urgentEmailEnabled) return { eligible: false, reason: "urgent emails disabled" };
  if (event.status !== "unread" && event.status !== "read") return { eligible: false, reason: `event is ${event.status}` };
  if (!event.requiresAction) return { eligible: false, reason: "event requires no action" };
  const floor = Math.max(SEVERITY_RANK[prefs.minimumEmailSeverity], SEVERITY_RANK[URGENT_SEVERITY_FLOOR]);
  if (SEVERITY_RANK[event.severity] < floor) return { eligible: false, reason: `severity ${event.severity} below threshold` };
  return { eligible: true };
}

export function urgentDedupeKey(userId: Id<"users">, eventId: Id<"events">, severity: EventSeverity): string {
  return `urgent|${userId}|${eventId}|${severity}`;
}

/**
 * Queue an urgent alert when the event is eligible and the user has not
 * already been alerted at this severity or higher. Escalation to a higher
 * severity creates a new alert; same or lower is suppressed.
 */
export async function maybeQueueUrgentForEvent(
  ctx: MutationCtx,
  event: Doc<"events">,
  now: number,
): Promise<{ queued: boolean; reason: string }> {
  const prefs = await getPreferencesFor(ctx, event.userId);
  const decision = isUrgentEligible(event, prefs);
  if (!decision.eligible) return { queued: false, reason: decision.reason };
  const user = await ctx.db.get("users", event.userId);
  if (!user) return { queued: false, reason: "user missing" };
  const recipient = resolveRecipient(user);
  if (!recipient.configured) return { queued: false, reason: "no recipient configured" };

  const previous = await ctx.db
    .query("notifications")
    .withIndex("by_event", (q) => q.eq("eventId", event._id))
    .take(50);
  const alreadyAt = previous
    .filter((n) => n.type === "urgent_event" && ACTIVE_STATUSES.has(n.status) && n.notifiedSeverity)
    .map((n) => SEVERITY_RANK[n.notifiedSeverity!]);
  if (alreadyAt.length > 0 && Math.max(...alreadyAt) >= SEVERITY_RANK[event.severity]) {
    return { queued: false, reason: "already alerted at this severity or higher" };
  }

  const result = await queueNotification(ctx, {
    userId: event.userId,
    type: "urgent_event",
    dedupeKey: urgentDedupeKey(event.userId, event._id, event.severity),
    recipientMasked: recipient.masked,
    eventId: event._id,
    notifiedSeverity: event.severity,
    now,
  });
  if (!result.created) return { queued: false, reason: `already ${result.existingStatus}` };
  await scheduleSend(ctx, result.notificationId);
  return { queued: true, reason: "queued" };
}

// ---------------------------------------------------------------------------
// Deadline reminders (§11)
// ---------------------------------------------------------------------------

export function reminderDedupeKey(userId: Id<"users">, eventId: Id<"events">, offset: string, deadline: number): string {
  return `reminder|${userId}|${eventId}|${offset}|${deadline}`;
}

function reminderEligible(event: Doc<"events">, prefs: Preferences): boolean {
  return (
    prefs.urgentEmailEnabled &&
    event.requiresAction &&
    event.deadline !== undefined &&
    (event.status === "unread" || event.status === "read" || event.status === "snoozed") &&
    event.severity !== "info"
  );
}

/**
 * Make scheduled reminders match the event's current deadline and state:
 * cancels reminders that no longer apply (deadline moved, event closed) and
 * schedules the missing ones. Stable keys make this safe to call repeatedly.
 */
export async function reconcileRemindersForEvent(
  ctx: MutationCtx,
  event: Doc<"events">,
  now: number,
): Promise<{ scheduled: number; cancelled: number }> {
  const prefs = await getPreferencesFor(ctx, event.userId);
  const user = await ctx.db.get("users", event.userId);
  const recipient = user ? resolveRecipient(user) : ({ configured: false, reason: "no user" } as RecipientResolution);

  const desired = new Map<string, { offset: string; fireAt: number }>();
  if (reminderEligible(event, prefs) && recipient.configured && event.deadline !== undefined) {
    for (const { label, ms } of REMINDER_OFFSETS) {
      const fireAt = event.deadline - ms;
      if (fireAt > now && fireAt - now <= REMINDER_SCHEDULE_HORIZON_MS) {
        desired.set(reminderDedupeKey(event.userId, event._id, label, event.deadline), { offset: label, fireAt });
      }
    }
  }

  const existing = (await ctx.db.query("notifications").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(50))
    .filter((n) => n.type === "deadline_reminder");

  let cancelled = 0;
  let scheduled = 0;
  for (const n of existing) {
    if (n.status !== "queued") continue;
    const want = desired.get(n.dedupeKey);
    if (want && n.scheduledFor === want.fireAt) {
      desired.delete(n.dedupeKey); // already correctly scheduled
      continue;
    }
    if (n.scheduledFunctionId) await ctx.scheduler.cancel(n.scheduledFunctionId);
    await ctx.db.patch("notifications", n._id, { status: "cancelled", scheduledFunctionId: undefined });
    cancelled += 1;
  }
  for (const [dedupeKey, want] of desired) {
    if (existing.some((n) => n.dedupeKey === dedupeKey && n.status !== "queued" && n.status !== "cancelled")) continue; // already sent/failed
    const result = await queueNotification(ctx, {
      userId: event.userId,
      type: "deadline_reminder",
      dedupeKey,
      recipientMasked: recipient.configured ? recipient.masked : "***",
      eventId: event._id,
      reminderOffset: want.offset,
      scheduledFor: want.fireAt,
      now,
    });
    const fnId = await ctx.scheduler.runAt(want.fireAt, internal.notifications.fireReminder, { notificationId: result.notificationId });
    await ctx.db.patch("notifications", result.notificationId, { scheduledFunctionId: fnId, scheduledFor: want.fireAt });
    scheduled += 1;
  }
  return { scheduled, cancelled };
}

export async function cancelRemindersForEvent(ctx: MutationCtx, eventId: Id<"events">): Promise<number> {
  const rows = (await ctx.db.query("notifications").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(50))
    .filter((n) => n.type === "deadline_reminder" && n.status === "queued");
  for (const n of rows) {
    if (n.scheduledFunctionId) await ctx.scheduler.cancel(n.scheduledFunctionId);
    await ctx.db.patch("notifications", n._id, { status: "cancelled", scheduledFunctionId: undefined });
  }
  return rows.length;
}

/**
 * Periodic sweep (cron): reconcile reminders for active actionable events so
 * deadlines that have come within the scheduling horizon get their reminders.
 */
export const reconcileDueReminders = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ scanned: number; scheduled: number; cancelled: number }> => {
    const now = Date.now();
    let scanned = 0;
    let scheduled = 0;
    let cancelled = 0;
    const events = await ctx.db.query("events").take(500);
    for (const event of events) {
      if (!event.requiresAction || event.deadline === undefined) continue;
      if (event.status !== "unread" && event.status !== "read" && event.status !== "snoozed") continue;
      if (event.deadline < now || event.deadline - now > REMINDER_SCHEDULE_HORIZON_MS + 24 * HOUR) continue;
      scanned += 1;
      const result = await reconcileRemindersForEvent(ctx, event, now);
      scheduled += result.scheduled;
      cancelled += result.cancelled;
    }
    return { scanned, scheduled, cancelled };
  },
});

/** Scheduled at the reminder time: re-check, then hand off to the sender. */
export const fireReminder = internalMutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const n = await ctx.db.get("notifications", args.notificationId);
    if (!n || n.status !== "queued" || !n.eventId) return null;
    const event = await ctx.db.get("events", n.eventId);
    const prefs = event ? await getPreferencesFor(ctx, event.userId) : null;
    const stillValid =
      event && prefs && reminderEligible(event, prefs) && event.deadline !== undefined &&
      n.dedupeKey === reminderDedupeKey(event.userId, event._id, n.reminderOffset ?? "", event.deadline);
    if (!stillValid) {
      await ctx.db.patch("notifications", n._id, { status: "cancelled", scheduledFunctionId: undefined });
      return null;
    }
    await ctx.db.patch("notifications", n._id, { scheduledFunctionId: undefined });
    await scheduleSend(ctx, n._id);
    return null;
  },
});

/** Called after any event insert/update: alerts and reminders follow the event. */
export async function onEventChanged(ctx: MutationCtx, event: Doc<"events">, now: number): Promise<void> {
  await maybeQueueUrgentForEvent(ctx, event, now);
  await reconcileRemindersForEvent(ctx, event, now);
}

// ---------------------------------------------------------------------------
// Send lifecycle (persistence side of the AgentMail action)
// ---------------------------------------------------------------------------

export type SendContext = {
  notification: Doc<"notifications">;
  prefs: Preferences;
  recipient: RecipientResolution;
  event: Doc<"events"> | null;
  brief: Doc<"briefs"> | null;
};

export const getForSend = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args): Promise<SendContext | null> => {
    const notification = await ctx.db.get("notifications", args.notificationId);
    if (!notification) return null;
    const user = await ctx.db.get("users", notification.userId);
    if (!user) return null;
    const [event, brief] = await Promise.all([
      notification.eventId ? ctx.db.get("events", notification.eventId) : null,
      notification.briefId ? ctx.db.get("briefs", notification.briefId) : null,
    ]);
    return {
      notification,
      prefs: await getPreferencesFor(ctx, user._id),
      recipient: resolveRecipient(user),
      event,
      brief,
    };
  },
});

export const markSending = internalMutation({
  args: { notificationId: v.id("notifications"), now: v.number() },
  handler: async (ctx, args): Promise<{ started: boolean; reason?: string; attempts: number }> => {
    const n = await ctx.db.get("notifications", args.notificationId);
    if (!n) return { started: false, reason: "not found", attempts: 0 };
    const retryable = n.status === "failed" && n.failureKind === "transient" && n.attempts < MAX_SEND_ATTEMPTS;
    if (n.status !== "queued" && !retryable) return { started: false, reason: `status ${n.status}`, attempts: n.attempts };
    if (n.attempts >= MAX_SEND_ATTEMPTS) return { started: false, reason: "attempts exhausted", attempts: n.attempts };
    await ctx.db.patch("notifications", n._id, { status: "sending", attempts: n.attempts + 1, lastAttemptAt: args.now });
    return { started: true, attempts: n.attempts + 1 };
  },
});

export const recordSent = internalMutation({
  args: { notificationId: v.id("notifications"), providerMessageId: v.string(), subject: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const n = await ctx.db.get("notifications", args.notificationId);
    if (!n) return null;
    await ctx.db.patch("notifications", n._id, {
      status: "sent",
      sentAt: args.now,
      providerMessageId: args.providerMessageId,
      subject: args.subject,
      failureKind: undefined,
      failureReason: undefined,
    });
    if (n.briefId) await ctx.db.patch("briefs", n.briefId, { sentViaEmail: true, notificationId: n._id });
    return null;
  },
});

export const recordSendFailure = internalMutation({
  args: { notificationId: v.id("notifications"), kind: v.string(), reason: v.string(), now: v.number() },
  handler: async (ctx, args): Promise<{ attempts: number }> => {
    const n = await ctx.db.get("notifications", args.notificationId);
    if (!n) return { attempts: 0 };
    await ctx.db.patch("notifications", n._id, {
      status: "failed",
      failureKind: args.kind,
      failureReason: args.reason.slice(0, 300),
      lastAttemptAt: args.now,
    });
    return { attempts: n.attempts };
  },
});

export const recordCancelled = internalMutation({
  args: { notificationId: v.id("notifications"), reason: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch("notifications", args.notificationId, { status: "cancelled", failureReason: args.reason.slice(0, 300) });
    return null;
  },
});

/** Webhook boundary: provider lifecycle for a message Numa sent. */
export const recordDeliveryEvent = internalMutation({
  args: { providerMessageId: v.string(), status: v.union(v.literal("delivered"), v.literal("bounced"), v.literal("rejected"), v.literal("complained"), v.literal("sent")) },
  handler: async (ctx, args): Promise<{ updated: boolean }> => {
    const n = await ctx.db
      .query("notifications")
      .withIndex("by_provider_message_id", (q) => q.eq("providerMessageId", args.providerMessageId))
      .unique();
    if (!n) return { updated: false };
    if (args.status === "sent" && n.status !== "sent") return { updated: false };
    if (args.status !== "sent") await ctx.db.patch("notifications", n._id, { status: args.status });
    return { updated: true };
  },
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export const listNotifications = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(30);
    const out = [];
    for (const n of rows) {
      const event = n.eventId ? await ctx.db.get("events", n.eventId) : null;
      const brief = n.briefId ? await ctx.db.get("briefs", n.briefId) : null;
      out.push({
        _id: n._id,
        type: n.type,
        status: n.status,
        recipient: n.recipient,
        subject: n.subject,
        createdAt: n.createdAt,
        sentAt: n.sentAt,
        scheduledFor: n.scheduledFor,
        reminderOffset: n.reminderOffset,
        attempts: n.attempts,
        failureKind: n.failureKind,
        failureReason: n.failureReason,
        isTest: n.isTest ?? false,
        providerMessageId: n.providerMessageId ? `${n.providerMessageId.slice(0, 10)}…` : undefined,
        event: event ? { _id: event._id, title: event.title, severity: event.severity } : null,
        brief: brief ? { _id: brief._id, headline: brief.headline, period: brief.period } : null,
      });
    }
    return out;
  },
});
