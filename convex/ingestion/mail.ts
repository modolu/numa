"use node";
/**
 * AgentMail delivery (NUMA_ARCHITECTURE.md §22, §28, §29):
 *
 *   queued notification → validate recipient + preferences → render trusted
 *   email from canonical data → AgentMail → persist providerMessageId / sent
 *
 * The provider call is the only network access. Failures are classified and
 * persisted sanitized; transient ones retry on a bounded schedule; nothing
 * here ever touches an event or a brief's content.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { toProviderError } from "../../lib/providers/errors";
import { toBriefItem } from "../../lib/notifications/brief";
import { renderBriefEmail, renderReminderEmail, renderUrgentEmail, type RenderedEmail } from "../../lib/notifications/templates";
import { createAgentMailProvider } from "../../lib/notifications/agentmail";
import { MAX_SEND_ATTEMPTS, SEND_RETRY_DELAYS_MS, type SendContext } from "../notifications";

export type SendResult =
  | { status: "sent"; notificationId: Id<"notifications">; providerMessageId: string }
  | { status: "failed"; notificationId: Id<"notifications">; kind: string; error: string; willRetry: boolean }
  | { status: "cancelled" | "skipped"; notificationId: Id<"notifications">; reason: string };

function createProvider() {
  return createAgentMailProvider({
    apiKey: process.env.AGENTMAIL_API_KEY || undefined,
    inboxId: process.env.AGENTMAIL_INBOX_ID || undefined,
  });
}

type RenderOutcome = { ok: true; email: RenderedEmail } | { ok: false; reason: string; cancel: boolean };

/** Deterministic rendering shared by the send path and the dev idempotency probe. */
export function renderNotification(context: SendContext): RenderOutcome {
  const { notification, event, brief } = context;
  const renderNow = notification.scheduledFor ?? notification.createdAt;
  const options = { now: renderNow, appUrl: process.env.NUMA_APP_URL || undefined, isTest: notification.isTest ?? false };
  if (notification.type === "daily_brief" || notification.type === "test_brief") {
    if (!brief) return { ok: false, reason: "brief missing", cancel: false };
    return { ok: true, email: renderBriefEmail({ headline: brief.headline, summary: brief.summary, items: brief.items, remaining: brief.remaining }, options) };
  }
  if (!event) return { ok: false, reason: "event missing", cancel: false };
  if (event.status === "completed" || event.status === "dismissed" || event.status === "expired") {
    return { ok: false, reason: `event is ${event.status}`, cancel: true };
  }
  const email =
    notification.type === "deadline_reminder"
      ? renderReminderEmail(toBriefItem(event), `in ${notification.reminderOffset ?? "soon"}`, options)
      : renderUrgentEmail(toBriefItem(event), options);
  return { ok: true, email };
}

export async function performSend(ctx: ActionCtx, notificationId: Id<"notifications">): Promise<SendResult> {
  const context = await ctx.runQuery(internal.notifications.getForSend, { notificationId });
  if (!context) return { status: "skipped", notificationId, reason: "notification not found" };
  const { notification, prefs, recipient } = context;
  const now = Date.now();

  if (!recipient.configured) {
    await ctx.runMutation(internal.notifications.recordSendFailure, { notificationId, kind: "permanent", reason: recipient.reason, now });
    return { status: "failed", notificationId, kind: "permanent", error: recipient.reason, willRetry: false };
  }
  const disabled =
    (notification.type === "daily_brief" && !prefs.emailDigestEnabled) ||
    ((notification.type === "urgent_event" || notification.type === "deadline_reminder") && !prefs.urgentEmailEnabled);
  if (disabled) {
    await ctx.runMutation(internal.notifications.recordCancelled, { notificationId, reason: "disabled by preferences" });
    return { status: "cancelled", notificationId, reason: "disabled by preferences" };
  }

  // Render from a fixed per-notification timestamp so every retry produces
  // byte-identical content under the same Idempotency-Key.
  const rendered = renderNotification(context);
  if (!rendered.ok) {
    if (rendered.cancel) {
      await ctx.runMutation(internal.notifications.recordCancelled, { notificationId, reason: rendered.reason });
      return { status: "cancelled", notificationId, reason: rendered.reason };
    }
    await ctx.runMutation(internal.notifications.recordSendFailure, { notificationId, kind: "permanent", reason: rendered.reason, now });
    return { status: "failed", notificationId, kind: "permanent", error: rendered.reason, willRetry: false };
  }
  const email = rendered.email;

  const claim = await ctx.runMutation(internal.notifications.markSending, { notificationId, now });
  if (!claim.started) return { status: "skipped", notificationId, reason: claim.reason ?? "not started" };

  const provider = createProvider();
  try {
    const result = await provider.send({
      to: recipient.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      idempotencyKey: notification.dedupeKey,
    });
    await ctx.runMutation(internal.notifications.recordSent, {
      notificationId,
      providerMessageId: result.providerMessageId,
      subject: email.subject,
      now: Date.now(),
    });
    return { status: "sent", notificationId, providerMessageId: result.providerMessageId };
  } catch (error) {
    const providerError = toProviderError(error, provider.provider);
    const message = `${provider.provider}: ${providerError.message}`;
    console.error("notification send failed", notificationId, providerError.kind, message);
    const { attempts } = await ctx.runMutation(internal.notifications.recordSendFailure, {
      notificationId,
      kind: providerError.kind,
      reason: message,
      now: Date.now(),
    });
    const willRetry = providerError.kind === "transient" && attempts < MAX_SEND_ATTEMPTS;
    if (willRetry) {
      const delay = SEND_RETRY_DELAYS_MS[Math.min(attempts, SEND_RETRY_DELAYS_MS.length) - 1] ?? SEND_RETRY_DELAYS_MS[0];
      await ctx.scheduler.runAfter(delay, internal.ingestion.mail.sendNotification, { notificationId });
    }
    return { status: "failed", notificationId, kind: providerError.kind, error: message, willRetry };
  }
}

export const sendNotification = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args): Promise<SendResult> => await performSend(ctx, args.notificationId),
});

/** Development-safe: send today's brief to the configured recipient, labelled as a test. */
export const sendTestBrief = action({
  args: {},
  handler: async (ctx): Promise<SendResult> => {
    const { notificationId } = await ctx.runMutation(internal.briefs.prepareTestBrief, {});
    return await performSend(ctx, notificationId);
  },
});

/**
 * DEVELOPMENT ONLY (internal): create/get Numa's sending inbox on AgentMail
 * idempotently (by client id) so `AGENTMAIL_INBOX_ID` can be configured.
 * Returns the inbox id (an email address), never the API key.
 */
export const devEnsureSenderInbox = internalAction({
  args: {},
  handler: async (): Promise<{ inboxId: string; created: boolean }> => {
    const apiKey = process.env.AGENTMAIL_API_KEY;
    if (!apiKey) throw new ConvexError("AGENTMAIL_API_KEY is not configured on this deployment");
    const { AgentMailClient } = await import("agentmail");
    const client = new AgentMailClient({ apiKey });
    const clientId = "numa-sender";
    const existing = await client.inboxes.list({ limit: 50 });
    const found = existing.inboxes.find((i) => i.clientId === clientId);
    if (found) return { inboxId: found.inboxId, created: false };
    const inbox = await client.inboxes.create({ clientId, displayName: "Numa" });
    return { inboxId: inbox.inboxId, created: true };
  },
});

/** DEVELOPMENT ONLY (internal): which AgentMail operations the configured key allows. Read-only; statuses only. */
export const devProbeAgentMail = internalAction({
  args: {},
  handler: async (): Promise<Record<string, string>> => {
    const apiKey = process.env.AGENTMAIL_API_KEY;
    if (!apiKey) throw new ConvexError("AGENTMAIL_API_KEY is not configured on this deployment");
    const { AgentMailClient } = await import("agentmail");
    const client = new AgentMailClient({ apiKey });
    const out: Record<string, string> = {};
    const attempt = async (name: string, fn: () => Promise<unknown>) => {
      try {
        const r = (await fn()) as Record<string, unknown> | undefined;
        out[name] = `ok${r && typeof r === "object" && "inboxId" in r ? ` inboxId=${String(r.inboxId)}` : ""}${r && typeof r === "object" && "count" in r ? ` count=${String(r.count)}` : ""}`;
      } catch (e) {
        const err = e as { statusCode?: number; message?: string };
        out[name] = `error ${err.statusCode ?? ""} ${String(err.message ?? "").split("\n")[0].slice(0, 80)}`;
      }
    };
    const inboxId = process.env.AGENTMAIL_INBOX_ID;
    const redact = (v: string) => v.replace(/[A-Za-z0-9._%+-]+@/g, "***@");
    if (inboxId) {
      await attempt("inboxes.get(configured)", () => client.inboxes.get(inboxId));
    }
    // Raw API calls surface the `code`/`fix` fields the SDK error may hide.
    const raw = async (name: string, path: string, init?: RequestInit) => {
      try {
        const res = await fetch(`https://api.agentmail.to/v0${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
        });
        const text = await res.text();
        out[`raw ${name}`] = `${res.status} ${redact(text).slice(0, 400)}`;
      } catch (e) {
        out[`raw ${name}`] = `fetch error ${String((e as Error).message).slice(0, 80)}`;
      }
    };
    if (inboxId) {
      out["inboxId shape"] = `${/@/.test(inboxId) ? "address" : "NOT an address"} · domain=${inboxId.split("@")[1] ?? "-"} · length=${inboxId.length} · whitespace=${/\s/.test(inboxId)}`;
    }
    out["apiKey shape"] = `length=${apiKey.length} · whitespace=${/\s/.test(apiKey)} · startsWithVarName=${apiKey.startsWith("AGENTMAIL_API_KEY=")} · containsEquals=${apiKey.includes("=")}`;
    await raw("GET /api-keys", "/api-keys?limit=3");
    await raw("GET /inboxes", "/inboxes?limit=3");
    if (inboxId) await raw("GET /inboxes/{configured}", `/inboxes/${encodeURIComponent(inboxId)}`);
    await attempt("inboxes.list", () => client.inboxes.list({ limit: 5 }));
    await attempt("inboxes.create(clientId=numa-sender)", () => client.inboxes.create({ clientId: "numa-sender", displayName: "Numa" }));
    await attempt("pods.list", () => client.pods.list({ limit: 5 }));
    await attempt("domains.list", () => client.domains.list({ limit: 5 }));
    return out;
  },
});

/**
 * DEVELOPMENT ONLY (internal): replay the exact provider request for an
 * already-sent notification under the same Idempotency-Key. AgentMail must
 * return the original message id and send no second email.
 */
export const devVerifyProviderIdempotency = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args): Promise<{ stored: string; replay: string; same: boolean }> => {
    const context = await ctx.runQuery(internal.notifications.getForSend, { notificationId: args.notificationId });
    if (!context || context.notification.status !== "sent" || !context.notification.providerMessageId) {
      throw new ConvexError("Notification must already be sent");
    }
    if (!context.recipient.configured) throw new ConvexError(context.recipient.reason);
    const rendered = renderNotification(context);
    if (!rendered.ok) throw new ConvexError(rendered.reason);
    const result = await createProvider().send({
      to: context.recipient.email,
      subject: rendered.email.subject,
      text: rendered.email.text,
      html: rendered.email.html,
      idempotencyKey: context.notification.dedupeKey,
    });
    return {
      stored: context.notification.providerMessageId,
      replay: result.providerMessageId,
      same: result.providerMessageId === context.notification.providerMessageId,
    };
  },
});
