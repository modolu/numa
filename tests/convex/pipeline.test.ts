import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { modules } from "../../convex/test.setup";
import { FIXTURE_SCENARIOS } from "../../convex/ingestion/fixtures";

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const HOUR = 3_600_000;

async function seeded() {
  const t = convexTest(schema, modules);
  const walletId = await t.mutation(api.wallets.addWallet, { address: WALLET });
  const first = await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
  return { t, walletId, first };
}

describe("add wallet → seed fixtures → inbox → mutate", () => {
  test("first ingestion creates one canonical event and task per fixture", async () => {
    const { t, first } = await seeded();
    expect(first).toMatchObject({
      received: FIXTURE_SCENARIOS.length,
      rawRecorded: FIXTURE_SCENARIOS.length,
      rawRepeated: 0,
      irrelevant: 0,
      created: FIXTURE_SCENARIOS.length,
      updated: 0,
      unchanged: 0,
    });

    const inbox = await t.query(api.events.getInbox, {});
    expect(inbox.attention).toHaveLength(FIXTURE_SCENARIOS.length);
    expect(inbox.snoozed).toHaveLength(0);
    expect(inbox.done).toHaveLength(0);
    expect(await t.query(api.events.getUnreadCount, {})).toBe(FIXTURE_SCENARIOS.length);
    for (const event of inbox.attention) {
      expect(event.status).toBe("unread");
      expect(event.isDemo).toBe(true);
      expect(event.dedupeKey).toContain(WALLET.toLowerCase());
    }

    const tasks = await t.query(api.tasks.getTasks, {});
    expect(tasks.open).toHaveLength(FIXTURE_SCENARIOS.length);
    expect(tasks.open.every((task) => task.event !== null)).toBe(true);

    // Raw observations are persisted and linked to their events.
    const raws = await t.run(async (ctx) => ctx.db.query("rawEvents").take(50));
    expect(raws).toHaveLength(FIXTURE_SCENARIOS.length);
    expect(raws.every((r) => r.processingStatus === "normalized" && r.eventId)).toBe(true);
  });

  test("repeated ingestion never duplicates inbox items", async () => {
    const { t, walletId } = await seeded();
    const second = await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
    expect(second).toMatchObject({
      rawRecorded: 0,
      rawRepeated: FIXTURE_SCENARIOS.length,
      created: 0,
      updated: 0,
      unchanged: FIXTURE_SCENARIOS.length,
    });
    const inbox = await t.query(api.events.getInbox, {});
    expect(inbox.attention).toHaveLength(FIXTURE_SCENARIOS.length);
    const events = await t.run(async (ctx) => ctx.db.query("events").take(100));
    expect(events).toHaveLength(FIXTURE_SCENARIOS.length);
    const tasks = await t.run(async (ctx) => ctx.db.query("tasks").take(100));
    expect(tasks).toHaveLength(FIXTURE_SCENARIOS.length);
  });

  test("re-ingestion preserves user state (read stays read)", async () => {
    const { t, walletId } = await seeded();
    const [first] = (await t.query(api.events.getInbox, {})).attention;
    await t.mutation(api.events.markRead, { eventId: first._id });
    await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
    const again = await t.query(api.events.getEvent, { eventId: first._id });
    expect(again?.event.status).toBe("read");
  });

  test("inbox is ordered by severity, then deadline", async () => {
    const { t } = await seeded();
    const inbox = await t.query(api.events.getInbox, {});
    const severities = inbox.attention.map((e) => e.severity);
    expect(severities[0]).toBe("high");
    expect(severities[severities.length - 1]).toBe("low");
    const ranks = { critical: 4, high: 3, medium: 2, low: 1, info: 0 } as const;
    for (let i = 1; i < inbox.attention.length; i++) {
      const prev = inbox.attention[i - 1];
      const cur = inbox.attention[i];
      expect(ranks[prev.severity]).toBeGreaterThanOrEqual(ranks[cur.severity]);
      if (prev.severity === cur.severity) {
        expect(prev.deadline ?? Infinity).toBeLessThanOrEqual(cur.deadline ?? Infinity);
      }
    }
    expect(inbox.attention[0].title).toMatch(/health factor is 1\.31/);
  });

  test("read → snooze → unsnooze → complete lifecycle through mutations", async () => {
    const { t } = await seeded();
    const [event] = (await t.query(api.events.getInbox, {})).attention;

    await t.mutation(api.events.markRead, { eventId: event._id });
    expect((await t.query(api.events.getEvent, { eventId: event._id }))?.event.status).toBe("read");
    expect(await t.query(api.events.getUnreadCount, {})).toBe(FIXTURE_SCENARIOS.length - 1);
    // Idempotent.
    await t.mutation(api.events.markRead, { eventId: event._id });

    const until = Date.now() + HOUR;
    await t.mutation(api.events.snoozeEvent, { eventId: event._id, until });
    let inbox = await t.query(api.events.getInbox, {});
    expect(inbox.snoozed.map((e) => e._id)).toEqual([event._id]);
    expect(inbox.snoozed[0].snoozeUntil).toBe(until);
    let tasks = await t.query(api.tasks.getTasks, {});
    expect(tasks.snoozed.map((task) => task.eventId)).toEqual([event._id]);

    await expect(
      t.mutation(api.events.snoozeEvent, { eventId: event._id, until: Date.now() - 1 }),
    ).rejects.toThrow(/future/);

    await t.mutation(api.events.unsnoozeEvent, { eventId: event._id });
    inbox = await t.query(api.events.getInbox, {});
    expect(inbox.attention.find((e) => e._id === event._id)?.status).toBe("unread");

    await t.mutation(api.events.completeEvent, { eventId: event._id });
    const detail = await t.query(api.events.getEvent, { eventId: event._id });
    expect(detail?.event.status).toBe("completed");
    expect(detail?.event.completedAt).toBeDefined();
    expect(detail?.task?.status).toBe("completed");
    tasks = await t.query(api.tasks.getTasks, {});
    expect(tasks.completed.map((task) => task.eventId)).toEqual([event._id]);

    // Terminal: no further transitions.
    await expect(t.mutation(api.events.markRead, { eventId: event._id })).rejects.toThrow(/completed/);
    await expect(t.mutation(api.events.dismissEvent, { eventId: event._id })).rejects.toThrow(/completed/);
    await expect(
      t.mutation(api.events.snoozeEvent, { eventId: event._id, until: Date.now() + HOUR }),
    ).rejects.toThrow(/completed/);
  });

  test("dismiss cancels the task; completing a task completes its event", async () => {
    const { t } = await seeded();
    const [a, b] = (await t.query(api.events.getInbox, {})).attention;

    await t.mutation(api.events.dismissEvent, { eventId: a._id });
    const aDetail = await t.query(api.events.getEvent, { eventId: a._id });
    expect(aDetail?.event.status).toBe("dismissed");
    expect(aDetail?.task?.status).toBe("cancelled");
    await expect(t.mutation(api.tasks.completeTask, { taskId: aDetail!.task!._id })).rejects.toThrow(
      /cancelled/,
    );

    const bDetail = await t.query(api.events.getEvent, { eventId: b._id });
    await t.mutation(api.tasks.completeTask, { taskId: bDetail!.task!._id });
    const bAfter = await t.query(api.events.getEvent, { eventId: b._id });
    expect(bAfter?.event.status).toBe("completed");

    const inbox = await t.query(api.events.getInbox, {});
    expect(inbox.done.map((e) => e._id).sort()).toEqual([a._id, b._id].sort());
    expect(inbox.attention).toHaveLength(FIXTURE_SCENARIOS.length - 2);
  });

  test("event detail joins wallet, protocol and task", async () => {
    const { t } = await seeded();
    const aave = (await t.query(api.events.getInbox, {})).attention.find(
      (e) => e.eventType === "position_risk",
    )!;
    const detail = await t.query(api.events.getEvent, { eventId: aave._id });
    expect(detail?.wallet?.address).toBe(WALLET.toLowerCase());
    expect(detail?.protocol?.name).toBe("Aave");
    expect(detail?.task?.title).toBe("Review collateral or debt");
    expect(detail?.event.metadata.priorityFactors).toMatchObject({ actionRequirement: 1 });
  });

  test("another user cannot see or mutate these events", async () => {
    const { t, walletId } = await seeded();
    const bob = t.withIdentity({ tokenIdentifier: "test|bob", subject: "bob", issuer: "test" });
    const [event] = (await t.query(api.events.getInbox, {})).attention;

    expect((await bob.query(api.events.getInbox, {})).attention).toHaveLength(0);
    expect(await bob.query(api.events.getEvent, { eventId: event._id })).toBeNull();
    await expect(bob.mutation(api.events.markRead, { eventId: event._id })).rejects.toThrow(/not found/i);
    await expect(
      bob.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId }),
    ).rejects.toThrow(/not found/i);
    // The original owner's state is untouched.
    expect((await t.query(api.events.getEvent, { eventId: event._id }))?.event.status).toBe("unread");
  });

  test("reset removes events, tasks and raw observations but keeps wallets", async () => {
    const { t } = await seeded();
    const result = await t.mutation(api.ingestion.fixtures.resetDemoData, {});
    expect(result.removed).toBe(FIXTURE_SCENARIOS.length * 3);
    expect((await t.query(api.events.getInbox, {})).attention).toHaveLength(0);
    expect(await t.query(api.wallets.getWallets, {})).toHaveLength(1);
  });
});
