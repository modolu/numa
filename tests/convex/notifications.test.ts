/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { modules } from "../../convex/test.setup";
import { FIXTURE_SCENARIOS } from "../../convex/ingestion/fixtures";
import { maybeQueueUrgentForEvent, reconcileRemindersForEvent, REMINDER_SCHEDULE_HORIZON_MS } from "../../convex/notifications";
import type { EmailProvider, EmailSendInput } from "../../lib/notifications/provider";
import { ProviderError } from "../../lib/providers/errors";

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const RECIPIENT = "dev-recipient@example.com";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Controllable fake email provider; records every send. */
const mail = vi.hoisted(() => ({
  sent: [] as EmailSendInput[],
  attempted: [] as EmailSendInput[],
  respond: null as null | ((input: EmailSendInput) => { providerMessageId: string }),
}));
vi.mock("../../lib/notifications/agentmail", () => ({
  createAgentMailProvider: (): EmailProvider => ({
    provider: "agentmail",
    providerLabel: "fake agentmail",
    send: async (input) => {
      if (!mail.respond) throw new Error("test did not configure respond()");
      mail.attempted.push(input);
      const r = mail.respond(input);
      mail.sent.push(input);
      return r;
    },
  }),
}));

type T = ReturnType<typeof convexTest>;
const notifications = (t: T) => t.run(async (ctx) => ctx.db.query("notifications").take(100));
const events = (t: T) => t.run(async (ctx) => ctx.db.query("events").take(100));
const send = (t: T, id: Id<"notifications">) => t.action(internal.ingestion.mail.sendNotification, { notificationId: id });

async function seeded() {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 20, 12, 0)); // 12:00 UTC
  const t = convexTest(schema, modules);
  const walletId = await t.mutation(api.wallets.addWallet, { address: WALLET });
  await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
  return { t, walletId };
}

beforeEach(() => {
  mail.sent = [];
  mail.attempted = [];
  let n = 0;
  mail.respond = () => ({ providerMessageId: `msg_${++n}` });
  process.env.NUMA_DEV_RECIPIENT_EMAIL = RECIPIENT;
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.NUMA_DEV_RECIPIENT_EMAIL;
});

describe("preferences and recipient", () => {
  test("defaults, validation and masked recipient", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.wallets.addWallet, { address: WALLET });
    const prefs = await t.query(api.notifications.getPreferences, {});
    expect(prefs).toMatchObject({ emailDigestEnabled: true, urgentEmailEnabled: true, digestTime: "08:00", timezone: "UTC", minimumEmailSeverity: "high" });
    expect(prefs?.recipient).toEqual({ configured: true, masked: "d******@example.com", source: "development" });
    await expect(t.mutation(api.notifications.setPreferences, { digestTime: "8am" })).rejects.toThrow(/HH:MM/);
    await expect(t.mutation(api.notifications.setPreferences, { timezone: "Nowhere/Land" })).rejects.toThrow(/timezone/i);
    await t.mutation(api.notifications.setPreferences, { digestTime: "07:30", timezone: "Europe/London", minimumEmailSeverity: "medium" });
    expect(await t.query(api.notifications.getPreferences, {})).toMatchObject({ digestTime: "07:30", timezone: "Europe/London", minimumEmailSeverity: "medium" });
    delete process.env.NUMA_DEV_RECIPIENT_EMAIL;
    expect((await t.query(api.notifications.getPreferences, {}))?.recipient).toMatchObject({ configured: false });
  });
});

describe("urgent alerts", () => {
  test("only actionable events at or above the threshold are alerted; info/low never", async () => {
    const { t } = await seeded();
    const rows = await notifications(t);
    const urgent = rows.filter((n) => n.type === "urgent_event");
    expect(urgent).toHaveLength(1);
    const aave = (await events(t)).find((e) => e.eventType === "position_risk")!;
    expect(urgent[0]).toMatchObject({ eventId: aave._id, notifiedSeverity: "high", status: "queued", recipient: "d******@example.com" });
    expect(urgent[0].dedupeKey).toBe(`urgent|${aave.userId}|${aave._id}|high`);
    // Re-seeding creates no second alert.
    const walletId = (await t.query(api.wallets.getWallets, {}))[0]._id;
    await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
    expect((await notifications(t)).filter((n) => n.type === "urgent_event")).toHaveLength(1);
  });

  test("a lower preference threshold still never alerts below medium; generic info updates never alert", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.wallets.addWallet, { address: WALLET });
    await t.mutation(api.notifications.setPreferences, { minimumEmailSeverity: "info" });
    const walletId = (await t.query(api.wallets.getWallets, {}))[0]._id;
    await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
    const urgent = (await notifications(t)).filter((n) => n.type === "urgent_event");
    // high + medium fixtures, never the info floor
    expect(urgent.map((n) => n.notifiedSeverity).sort()).toEqual(["high", "medium", "medium", "medium", "medium"]);
    const info: Doc<"events"> = { ...(await events(t))[0], _id: "fake" as Id<"events">, severity: "info", requiresAction: false, eventType: "protocol_update" };
    const decision = await t.run(async (ctx) => maybeQueueUrgentForEvent(ctx, info, Date.now()));
    expect(decision).toMatchObject({ queued: false, reason: /requires no action/ });
  });

  test("escalation creates a new alert; same or lower severity is suppressed; closed events are not alerted", async () => {
    const { t } = await seeded();
    const aave = (await events(t)).find((e) => e.eventType === "position_risk")!;
    const same = await t.run(async (ctx) => maybeQueueUrgentForEvent(ctx, aave, Date.now()));
    expect(same).toMatchObject({ queued: false, reason: /already alerted/ });
    const critical = await t.run(async (ctx) => maybeQueueUrgentForEvent(ctx, { ...aave, severity: "critical" }, Date.now()));
    expect(critical).toMatchObject({ queued: true });
    const back = await t.run(async (ctx) => maybeQueueUrgentForEvent(ctx, { ...aave, severity: "high" }, Date.now()));
    expect(back).toMatchObject({ queued: false });
    expect((await notifications(t)).filter((n) => n.type === "urgent_event").map((n) => n.notifiedSeverity).sort()).toEqual(["critical", "high"]);
    await t.mutation(api.events.dismissEvent, { eventId: aave._id });
    const dismissed = await t.run(async (ctx) => maybeQueueUrgentForEvent(ctx, { ...aave, status: "dismissed", severity: "critical" }, Date.now()));
    expect(dismissed).toMatchObject({ queued: false, reason: /dismissed/ });
    // A queued alert for a since-dismissed event is cancelled at send time.
    const queued = (await notifications(t)).find((n) => n.type === "urgent_event" && n.status === "queued")!;
    expect(await send(t, queued._id)).toMatchObject({ status: "cancelled", reason: /dismissed/ });
    expect(mail.sent).toHaveLength(0);
  });

  test("disabled urgent emails suppress alerts and cancel queued ones at send time", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.wallets.addWallet, { address: WALLET });
    await t.mutation(api.notifications.setPreferences, { urgentEmailEnabled: false });
    const walletId = (await t.query(api.wallets.getWallets, {}))[0]._id;
    await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
    expect((await notifications(t)).filter((n) => n.type === "urgent_event")).toHaveLength(0);
    expect((await notifications(t)).filter((n) => n.type === "deadline_reminder")).toHaveLength(0);
  });
});

describe("deadline reminders", () => {
  test("schedules 24h/1h reminders for actionable deadlines still ahead, idempotently", async () => {
    const { t, walletId } = await seeded();
    const reminders = (await notifications(t)).filter((n) => n.type === "deadline_reminder");
    // governance (7h): only 1h · ENS (12d): both · migration (30d): both
    expect(reminders.map((n) => n.reminderOffset).sort()).toEqual(["1h", "1h", "1h", "24h", "24h"]);
    expect(reminders.every((n) => n.status === "queued" && n.scheduledFunctionId && n.scheduledFor)).toBe(true);
    await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
    expect((await notifications(t)).filter((n) => n.type === "deadline_reminder")).toHaveLength(5);
  });

  test("a changed deadline cancels stale reminders and schedules fresh ones", async () => {
    const { t } = await seeded();
    const ens = (await events(t)).find((e) => e.eventType === "ens_expiry")!;
    const before = (await notifications(t)).filter((n) => n.eventId === ens._id && n.type === "deadline_reminder");
    expect(before).toHaveLength(2);
    const newDeadline = Date.now() + 3 * DAY;
    await t.run(async (ctx) => {
      await ctx.db.patch("events", ens._id, { deadline: newDeadline });
      const updated = (await ctx.db.get("events", ens._id))!;
      return reconcileRemindersForEvent(ctx, updated, Date.now());
    });
    const after = (await notifications(t)).filter((n) => n.eventId === ens._id && n.type === "deadline_reminder");
    expect(after.filter((n) => n.status === "cancelled")).toHaveLength(2);
    const live = after.filter((n) => n.status === "queued");
    expect(live.map((n) => n.scheduledFor).sort()).toEqual([newDeadline - DAY, newDeadline - HOUR]);
    expect(live.every((n) => n.dedupeKey.endsWith(`|${newDeadline}`))).toBe(true);
  });

  test("deadlines beyond the horizon are not scheduled until the sweep brings them in range", async () => {
    const { t } = await seeded();
    const ens = (await events(t)).find((e) => e.eventType === "ens_expiry")!;
    const farDeadline = Date.now() + 22 * 365 * DAY; // e.g. a 2048 ENS expiry
    const result = await t.run(async (ctx) => {
      await ctx.db.patch("events", ens._id, { deadline: farDeadline });
      return reconcileRemindersForEvent(ctx, (await ctx.db.get("events", ens._id))!, Date.now());
    });
    expect(result).toEqual({ scheduled: 0, cancelled: 2 }); // old 12-day reminders cancelled, nothing far out
    expect((await notifications(t)).filter((n) => n.eventId === ens._id && n.status === "queued")).toHaveLength(0);

    // The sweep schedules once the deadline comes within the horizon.
    const soonDeadline = Date.now() + REMINDER_SCHEDULE_HORIZON_MS - DAY;
    await t.run(async (ctx) => ctx.db.patch("events", ens._id, { deadline: soonDeadline }));
    const sweep = await t.mutation(internal.notifications.reconcileDueReminders, {});
    expect(sweep.scheduled).toBeGreaterThanOrEqual(2);
    const live = (await notifications(t)).filter((n) => n.eventId === ens._id && n.status === "queued");
    expect(live.map((n) => n.reminderOffset).sort()).toEqual(["1h", "24h"]);
    // Sweep is idempotent.
    expect((await t.mutation(internal.notifications.reconcileDueReminders, {})).scheduled).toBe(0);
  });

  test("completing or dismissing cancels reminders; firing sends when still valid", async () => {
    const { t } = await seeded();
    const gov = (await events(t)).find((e) => e.eventType === "governance_deadline")!;
    const ens = (await events(t)).find((e) => e.eventType === "ens_expiry")!;
    await t.mutation(api.events.completeEvent, { eventId: ens._id });
    expect((await notifications(t)).filter((n) => n.eventId === ens._id && n.type === "deadline_reminder").every((n) => n.status === "cancelled")).toBe(true);

    // Advance to the governance 1h reminder and let the scheduler fire it.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const govReminder = (await notifications(t)).find((n) => n.eventId === gov._id && n.type === "deadline_reminder")!;
    expect(govReminder.status).toBe("sent");
    expect(mail.sent.some((m) => m.subject.includes("reminder") && m.subject.includes("(in 1h)"))).toBe(true);
    // Reminders for the migration event were cancelled or sent exactly once each.
    const migration = (await events(t)).find((e) => e.eventType === "protocol_migration")!;
    const migrationReminders = (await notifications(t)).filter((n) => n.eventId === migration._id && n.type === "deadline_reminder");
    expect(migrationReminders.map((n) => n.status).sort()).toEqual(["sent", "sent"]);
    expect(mail.sent.filter((m) => m.subject.includes("reminder")).length).toBe(3);
  });
});

describe("daily brief", () => {
  test("generates a deterministic snapshot from canonical events and is idempotent per period", async () => {
    const { t } = await seeded();
    const first = await t.mutation(api.briefs.generateBrief, {});
    expect(first).toMatchObject({ created: true, itemCount: 5 });
    const second = await t.mutation(api.briefs.generateBrief, {});
    expect(second).toMatchObject({ created: false, briefId: first.briefId });
    const today = await t.query(api.briefs.getTodayBrief, { now: Date.now() });
    expect(today?.period).toBe("2026-09-20");
    expect(today?.brief?.headline).toBe("5 things matter today.");
    expect(today?.brief?.items[0].title).toMatch(/health factor is 1\.31/);
    expect(today?.brief?.items.every((i) => i.isDemo)).toBe(true);
    expect(today?.brief?.sentViaEmail).toBe(false);
    expect(today?.notification).toBeNull();
    // Force regenerates after a change.
    const aave = (await events(t)).find((e) => e.eventType === "position_risk")!;
    await t.mutation(api.events.dismissEvent, { eventId: aave._id });
    const forced = await t.mutation(api.briefs.generateBrief, { force: true });
    expect(forced).toMatchObject({ created: true, itemCount: 4 });
  });

  test("sendDigest(user, period) is idempotent and delivers once", async () => {
    const { t } = await seeded();
    const userId = (await events(t))[0].userId;
    const a = await t.mutation(internal.briefs.sendDigest, { userId });
    const b = await t.mutation(internal.briefs.sendDigest, { userId });
    expect(a.queued).toBe(true);
    expect(b).toEqual({ briefId: a.briefId, queued: false });
    const briefs = (await notifications(t)).filter((n) => n.type === "daily_brief");
    expect(briefs).toHaveLength(1);
    expect(briefs[0].dedupeKey).toBe(`daily_brief|${userId}|2026-09-20`);

    const result = await send(t, briefs[0]._id);
    expect(result).toMatchObject({ status: "sent", providerMessageId: "msg_1" });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: RECIPIENT, subject: "Numa brief · 5 things matter today." });
    expect(mail.sent[0].html).toContain("DEMO DATA");
    const row = (await notifications(t)).find((n) => n.type === "daily_brief")!;
    expect(row).toMatchObject({ status: "sent", providerMessageId: "msg_1", attempts: 1, recipient: "d******@example.com" });
    expect(row.sentAt).toBeDefined();
    expect((await t.query(api.briefs.getTodayBrief, { now: Date.now() }))?.brief?.sentViaEmail).toBe(true);
    // Duplicate action invocation does not resend.
    expect(await send(t, row._id)).toMatchObject({ status: "skipped" });
    expect(mail.sent).toHaveLength(1);
  });

  test("the digest job queues within each user's local window, once", async () => {
    const { t } = await seeded();
    await t.mutation(api.notifications.setPreferences, { digestTime: "08:00", timezone: "America/New_York" }); // 12:00 UTC = 08:00 NY
    expect(await t.mutation(internal.jobs.sendDigests.run, {})).toEqual({ queued: 1, skipped: 0 });
    expect(await t.mutation(internal.jobs.sendDigests.run, {})).toEqual({ queued: 0, skipped: 1 });
    expect(await t.mutation(internal.jobs.sendDigests.run, { now: Date.now() + 2 * HOUR })).toEqual({ queued: 0, skipped: 1 }); // outside window
    await t.mutation(api.notifications.setPreferences, { emailDigestEnabled: false });
    expect(await t.mutation(internal.jobs.sendDigests.run, { now: Date.now() + DAY })).toEqual({ queued: 0, skipped: 1 });
  });

  test("test brief sends labelled mail to the configured recipient only, with a cooldown", async () => {
    const { t } = await seeded();
    const result = await t.action(api.ingestion.mail.sendTestBrief, {});
    expect(result.status).toBe("sent");
    expect(mail.sent[0].to).toBe(RECIPIENT);
    expect(mail.sent[0].text).toContain("TEST MESSAGE");
    await expect(t.action(api.ingestion.mail.sendTestBrief, {})).rejects.toThrow(/moment ago/);
    const history = await t.query(api.notifications.listNotifications, {});
    expect(history.find((n) => n.type === "test_brief")).toMatchObject({ status: "sent", isTest: true, recipient: "d******@example.com" });
    expect(history[0].providerMessageId).toMatch(/…$/);
  });
});

describe("failure handling", () => {
  test("transient failures retry on the bounded schedule and never touch the brief or inbox", async () => {
    const { t } = await seeded();
    const userId = (await events(t))[0].userId;
    const { briefId } = await t.mutation(internal.briefs.sendDigest, { userId });
    const row = (await notifications(t)).find((n) => n.type === "daily_brief")!;
    let calls = 0;
    mail.respond = (input) => {
      if (!input.subject.startsWith("Numa brief")) return { providerMessageId: "other" }; // reminders/alerts also fire
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("Service unavailable https://api.agentmail.to"), { statusCode: 503 });
      return { providerMessageId: "msg_ok" };
    };
    const inboxBefore = await t.query(api.events.getInbox, {});

    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
    let n = (await notifications(t)).find((x) => x._id === row._id)!;
    expect(n).toMatchObject({ status: "failed", failureKind: "transient", attempts: 1, failureReason: "agentmail: Service unavailable [endpoint]" });
    expect(await t.run(async (ctx) => ctx.db.get("briefs", briefId))).toMatchObject({ sentViaEmail: false, headline: "5 things matter today." });
    expect(await t.query(api.events.getInbox, {})).toEqual(inboxBefore);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    n = (await notifications(t)).find((x) => x._id === row._id)!;
    expect(n).toMatchObject({ status: "sent", providerMessageId: "msg_ok", attempts: 3 });
    expect(calls).toBe(3);
    // Every retry carried Numa's deterministic identity as the provider idempotency key
    // and byte-identical content, so a provider-side replay is safe.
    const briefAttempts = mail.attempted.filter((m) => m.subject.startsWith("Numa brief"));
    expect(briefAttempts).toHaveLength(3);
    expect(briefAttempts.every((m) => m.idempotencyKey === row.dedupeKey)).toBe(true);
    expect(new Set(briefAttempts.map((m) => m.html)).size).toBe(1); // identical across retries
  });

  test("permanent and malformed failures stop immediately; invalid recipient fails permanently", async () => {
    const { t } = await seeded();
    const userId = (await events(t))[0].userId;
    await t.mutation(internal.briefs.sendDigest, { userId });
    const row = (await notifications(t)).find((n) => n.type === "daily_brief")!;
    mail.respond = () => { throw Object.assign(new Error("Unauthorized"), { statusCode: 401 }); };
    expect(await send(t, row._id)).toMatchObject({ status: "failed", kind: "permanent", willRetry: false });
    expect((await notifications(t)).find((n) => n._id === row._id)).toMatchObject({ status: "failed", failureKind: "permanent", attempts: 1 });
    expect(await send(t, row._id)).toMatchObject({ status: "skipped" }); // not retried

    const t2 = (await seeded()).t;
    const userId2 = (await events(t2))[0].userId;
    await t2.mutation(internal.briefs.sendDigest, { userId: userId2 });
    const row2 = (await notifications(t2)).find((n) => n.type === "daily_brief")!;
    mail.respond = () => { throw new ProviderError("Send response had no message id", "malformed", "agentmail"); };
    expect(await send(t2, row2._id)).toMatchObject({ status: "failed", kind: "malformed", willRetry: false });

    delete process.env.NUMA_DEV_RECIPIENT_EMAIL;
    const t3 = (await seeded()).t;
    const userId3 = (await events(t3))[0].userId;
    await t3.mutation(internal.briefs.sendDigest, { userId: userId3 });
    const row3 = (await notifications(t3)).find((n) => n.type === "daily_brief")!;
    expect(await send(t3, row3._id)).toMatchObject({ status: "failed", kind: "permanent", error: /No recipient/ });
    expect(mail.sent).toHaveLength(0);
  });

  test("preferences disabled at send time cancel the message", async () => {
    const { t } = await seeded();
    const userId = (await events(t))[0].userId;
    await t.mutation(internal.briefs.sendDigest, { userId });
    await t.mutation(api.notifications.setPreferences, { emailDigestEnabled: false });
    const row = (await notifications(t)).find((n) => n.type === "daily_brief")!;
    expect(await send(t, row._id)).toMatchObject({ status: "cancelled" });
    expect(mail.sent).toHaveLength(0);
  });
});

describe("webhook boundary", () => {
  test("verified delivery events update the notification; unsigned ones are rejected", async () => {
    const { t } = await seeded();
    const userId = (await events(t))[0].userId;
    await t.mutation(internal.briefs.sendDigest, { userId });
    const row = (await notifications(t)).find((n) => n.type === "daily_brief")!;
    await send(t, row._id);

    process.env.AGENTMAIL_WEBHOOK_SECRET = "whsec_" + btoa("hooksecret1234567");
    const body = JSON.stringify({ event_type: "message.delivered", message: { message_id: "msg_1" } });
    const ts = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("hooksecret1234567"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = "v1," + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`id_1.${ts}.${body}`)))));

    const unsigned = await t.fetch("/webhooks/agentmail", { method: "POST", body });
    expect(unsigned.status).toBe(401);
    const ok = await t.fetch("/webhooks/agentmail", { method: "POST", body, headers: { "svix-id": "id_1", "svix-timestamp": ts, "svix-signature": sig } });
    expect(ok.status).toBe(200);
    expect((await notifications(t)).find((n) => n._id === row._id)?.status).toBe("delivered");
    delete process.env.AGENTMAIL_WEBHOOK_SECRET;
    expect((await t.fetch("/webhooks/agentmail", { method: "POST", body })).status).toBe(503);
  });
});

describe("regression", () => {
  test("fixtures, dedupe and lifecycle still behave with notifications enabled", async () => {
    const { t, walletId } = await seeded();
    expect((await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId })).unchanged).toBe(FIXTURE_SCENARIOS.length);
    const inbox = await t.query(api.events.getInbox, {});
    expect(inbox.attention).toHaveLength(FIXTURE_SCENARIOS.length);
    await t.mutation(api.ingestion.fixtures.resetDemoData, {});
    expect(await notifications(t)).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.query("briefs").take(10))).toHaveLength(0);
  });
});
