/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { modules } from "../../convex/test.setup";
import { FIXTURE_SCENARIOS } from "../../convex/ingestion/fixtures";
import type { OnchainAdapter } from "../../lib/onchain/provider";
import { ProviderError } from "../../lib/onchain/provider";
import type { RawEventInput } from "../../lib/events/raw";

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const WALLET_LOWER = WALLET.toLowerCase();
const OTHER_HOLDER = "0x220866b1a2219f40e72f5c628b65d54268ca3a9d";
const DAY = 24 * 3_600_000;

/**
 * The adapter registry is replaced with a controllable fake so no test
 * touches the network. `state.discover` decides what a scan sees.
 */
const state = vi.hoisted(() => ({
  discover: null as null | (() => Promise<{ rawEvents: RawEventInput[]; skipped: { subject: string; reason: string }[] }>),
}));

vi.mock("../../convex/ingestion/adapters", () => ({
  createAdapters: (): OnchainAdapter[] => [
    {
      source: "ens",
      providerLabel: "fake ENS provider",
      discover: async () => {
        if (!state.discover) throw new Error("test did not configure discover()");
        return await state.discover();
      },
    },
  ],
}));

function ensRaw(expiresAt: number, overrides: Partial<RawEventInput["payload"]> = {}): RawEventInput {
  return {
    source: "ens",
    sourceEventId: `ens:1:${WALLET_LOWER}:numa-live.eth`,
    observedAt: Date.now(),
    isDemo: false,
    payload: {
      kind: "ens_expiry",
      wallet: WALLET_LOWER,
      protocol: "ens",
      chainId: 1,
      name: "numa-live.eth",
      expiresAt,
      gracePeriodEndsAt: expiresAt + 90 * DAY,
      relationship: "registrant",
      tokenId: "123",
      renewUrl: "https://app.ens.domains/numa-live.eth",
      registrarContract: "0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85",
      observedBlock: 26_000_000,
      ...overrides,
    } as RawEventInput["payload"],
  };
}

function succeedWith(...rawEvents: RawEventInput[]) {
  state.discover = async () => ({ rawEvents, skipped: [] });
}

async function setup() {
  const t = convexTest(schema, modules);
  const walletId = await t.mutation(api.wallets.addWallet, { address: WALLET });
  return { t, walletId };
}

beforeEach(() => {
  state.discover = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("wallet scan → rawEvent → canonical ens_expiry → inbox", () => {
  test("a live scan persists the raw observation and a live inbox event", async () => {
    const { t, walletId } = await setup();
    const expiresAt = Date.now() + 12 * DAY;
    succeedWith(ensRaw(expiresAt));

    const result = await t.action(api.ingestion.wallet.scanWallet, { walletId });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.providers).toEqual(["fake ENS provider"]);
    expect(result.summary).toMatchObject({ received: 1, rawRecorded: 1, created: 1, irrelevant: 0 });
    expect(result.rejected).toBe(0);

    const raws = await t.run(async (ctx) => ctx.db.query("rawEvents").take(10));
    expect(raws).toHaveLength(1);
    expect(raws[0]).toMatchObject({
      source: "ens",
      sourceEventId: `ens:1:${WALLET_LOWER}:numa-live.eth`,
      walletId,
      chainId: 1,
      processingStatus: "normalized",
    });
    expect(typeof raws[0].contentHash).toBe("string");
    expect(raws[0].payload).toMatchObject({ kind: "ens_expiry", name: "numa-live.eth", observedBlock: 26_000_000 });
    expect(raws[0].eventId).toBeDefined();

    const inbox = await t.query(api.events.getInbox, {});
    expect(inbox.attention).toHaveLength(1);
    const event = inbox.attention[0];
    expect(event).toMatchObject({
      eventType: "ens_expiry",
      category: "deadline",
      requiresAction: true,
      isDemo: false,
      status: "unread",
      severity: "medium",
      sourceType: "onchain",
      deadline: expiresAt,
      walletId,
      chainId: 1,
      title: "numa-live.eth expires soon",
    });
    expect(event.sourceRef).toBe("0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85#123");
    expect(event.metadata).toMatchObject({ relationship: "registrant", expiryStage: "month" });
    expect(event.metadata.observedBlock).toBeUndefined();
    expect(event.dedupeKey).toBe(`${event.userId}|${WALLET_LOWER}|ens_expiry|ens|numa-live.eth`);

    const wallets = await t.query(api.wallets.getWallets, {});
    expect(wallets[0]).toMatchObject({ lastScanStatus: "ok" });
    expect(wallets[0].lastScannedAt).toBeDefined();
    expect(wallets[0].lastScanError).toBeUndefined();

    const detail = await t.query(api.events.getEvent, { eventId: event._id });
    expect(detail?.protocol?.name).toBe("ENS");
    expect(detail?.task?.title).toBe("Review and renew the registration");
  });

  test("re-scanning the same state is a no-op and never duplicates", async () => {
    const { t, walletId } = await setup();
    const expiresAt = Date.now() + 12 * DAY;
    succeedWith(ensRaw(expiresAt));
    await t.action(api.ingestion.wallet.scanWallet, { walletId });

    // Different block, same registration state.
    succeedWith(ensRaw(expiresAt, { observedBlock: 26_000_050 }));
    const second = await t.action(internal.ingestion.wallet.runScheduledScan, { walletId });
    expect(second.status).toBe("ok");
    if (second.status !== "ok") throw new Error("unreachable");
    expect(second.summary).toMatchObject({ rawRepeated: 1, rawRecorded: 0, created: 0, updated: 0, unchanged: 1 });

    expect(await t.run(async (ctx) => ctx.db.query("events").take(10))).toHaveLength(1);
    expect(await t.run(async (ctx) => ctx.db.query("rawEvents").take(10))).toHaveLength(1);
    expect(await t.run(async (ctx) => ctx.db.query("tasks").take(10))).toHaveLength(1);
  });

  test("a renewal updates the same logical event and preserves user state", async () => {
    const { t, walletId } = await setup();
    const soon = Date.now() + 5 * DAY;
    succeedWith(ensRaw(soon));
    await t.action(api.ingestion.wallet.scanWallet, { walletId });
    const [event] = (await t.query(api.events.getInbox, {})).attention;
    expect(event.severity).toBe("medium");
    await t.mutation(api.events.snoozeEvent, { eventId: event._id, until: Date.now() + DAY });

    const renewed = soon + 365 * DAY;
    succeedWith(ensRaw(renewed));
    const result = await t.action(internal.ingestion.wallet.runScheduledScan, { walletId });
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.summary).toMatchObject({ created: 0, updated: 1 });

    const after = await t.query(api.events.getEvent, { eventId: event._id });
    expect(after?.event.deadline).toBe(renewed);
    expect(after?.event.severity).toBe("low");
    expect(after?.event.title).toMatch(/expires on/);
    expect(after?.event.status).toBe("snoozed"); // user state untouched
    expect(await t.run(async (ctx) => ctx.db.query("events").take(10))).toHaveLength(1);
  });

  test("provider failure is recorded and leaves last-known data intact", async () => {
    const { t, walletId } = await setup();
    succeedWith(ensRaw(Date.now() + 12 * DAY));
    await t.action(api.ingestion.wallet.scanWallet, { walletId });
    const before = (await t.query(api.wallets.getWallets, {}))[0];

    state.discover = async () => {
      throw new Error("HTTP request failed.\nURL: https://rpc.example/v1/SECRETKEY\nDetails: timeout");
    };
    const result = await t.action(internal.ingestion.wallet.runScheduledScan, { walletId });
    expect(result).toMatchObject({
      status: "failed",
      kind: "transient",
      retryable: true,
      error: "ens: HTTP request failed.",
    });

    const wallet = (await t.query(api.wallets.getWallets, {}))[0];
    expect(wallet.lastScanStatus).toBe("failed");
    expect(wallet.lastScanError).toBe("ens: HTTP request failed.");
    expect(wallet.lastScanError).not.toContain("SECRETKEY");
    expect(wallet.lastScannedAt).toBe(before.lastScannedAt);

    const inbox = await t.query(api.events.getInbox, {});
    expect(inbox.attention).toHaveLength(1);
    expect(await t.run(async (ctx) => ctx.db.query("rawEvents").take(10))).toHaveLength(1);

    // Permanent failures are reported as not retryable.
    state.discover = async () => {
      throw new ProviderError("Unsupported ENS name", "permanent", "ens", 400);
    };
    const permanent = await t.action(internal.ingestion.wallet.runScheduledScan, { walletId });
    expect(permanent).toMatchObject({ status: "failed", kind: "permanent", retryable: false });

    // Recovery clears the error.
    succeedWith(ensRaw(Date.now() + 12 * DAY));
    const recovered = await t.action(internal.ingestion.wallet.runScheduledScan, { walletId });
    expect(recovered.status).toBe("ok");
    const healthy = (await t.query(api.wallets.getWallets, {}))[0];
    expect(healthy.lastScanStatus).toBe("ok");
    expect(healthy.lastScanError).toBeUndefined();
  });

  test("malformed adapter output is rejected before persistence", async () => {
    const { t, walletId } = await setup();
    state.discover = async () => ({
      rawEvents: [
        { source: "ens", sourceEventId: "x", observedAt: Date.now(), isDemo: false, payload: { kind: "mystery" } } as unknown as RawEventInput,
        // A live scan may never inject demo-flagged data.
        { ...ensRaw(Date.now() + DAY), isDemo: true },
      ],
      skipped: [],
    });
    const result = await t.action(api.ingestion.wallet.scanWallet, { walletId });
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.rejected).toBe(2);
    expect(result.summary.received).toBe(0);
    expect(await t.run(async (ctx) => ctx.db.query("events").take(10))).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.query("rawEvents").take(10))).toHaveLength(0);
  });

  test("observations about another wallet are stored but not surfaced", async () => {
    const { t, walletId } = await setup();
    succeedWith(ensRaw(Date.now() + DAY, { wallet: OTHER_HOLDER }));
    const result = await t.action(api.ingestion.wallet.scanWallet, { walletId });
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.summary).toMatchObject({ irrelevant: 1, created: 0 });
    const raws = await t.run(async (ctx) => ctx.db.query("rawEvents").take(10));
    expect(raws[0].processingStatus).toBe("irrelevant");
    expect((await t.query(api.events.getInbox, {})).attention).toHaveLength(0);
  });

  test("primary-name-only relationship is relevant with lower confidence", async () => {
    const { t, walletId } = await setup();
    succeedWith(ensRaw(Date.now() + 12 * DAY, { relationship: "primary_name", registrant: OTHER_HOLDER }));
    await t.action(api.ingestion.wallet.scanWallet, { walletId });
    const [event] = (await t.query(api.events.getInbox, {})).attention;
    expect(event.confidence).toBe(0.8);
    expect(event.metadata.registrant).toBe(OTHER_HOLDER);
    expect(String(event.metadata.relevanceReason)).toMatch(/primary ENS name/);
  });

  test("another user cannot scan this wallet", async () => {
    const { t, walletId } = await setup();
    succeedWith(ensRaw(Date.now() + DAY));
    const bob = t.withIdentity({ tokenIdentifier: "test|bob", subject: "bob", issuer: "test" });
    await expect(bob.action(api.ingestion.wallet.scanWallet, { walletId })).rejects.toThrow(/not found/i);
    expect(await t.run(async (ctx) => ctx.db.query("rawEvents").take(10))).toHaveLength(0);
  });

  test("rapid repeat manual scans are skipped by the cooldown", async () => {
    const { t, walletId } = await setup();
    succeedWith(ensRaw(Date.now() + DAY));
    const first = await t.action(api.ingestion.wallet.scanWallet, { walletId });
    const second = await t.action(api.ingestion.wallet.scanWallet, { walletId });
    expect(first.status).toBe("ok");
    expect(second).toMatchObject({ status: "skipped", reason: expect.stringMatching(/moment ago/) });
    // Scheduled scans are not subject to the manual cooldown.
    const scheduled = await t.action(internal.ingestion.wallet.runScheduledScan, { walletId });
    expect(scheduled.status).toBe("ok");
  });

  test("live ENS and demo fixtures coexist without interfering", async () => {
    const { t, walletId } = await setup();
    succeedWith(ensRaw(Date.now() + 12 * DAY));
    await t.action(api.ingestion.wallet.scanWallet, { walletId });
    const seed = await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
    expect(seed.created).toBe(FIXTURE_SCENARIOS.length);
    const inbox = await t.query(api.events.getInbox, {});
    expect(inbox.attention).toHaveLength(FIXTURE_SCENARIOS.length + 1);
    expect(inbox.attention.filter((e) => !e.isDemo)).toHaveLength(1);
    expect(inbox.attention.filter((e) => e.eventType === "ens_expiry")).toHaveLength(2);
    // Re-seeding still leaves the live event alone.
    const again = await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
    expect(again.unchanged).toBe(FIXTURE_SCENARIOS.length);
    expect((await t.query(api.events.getInbox, {})).attention).toHaveLength(FIXTURE_SCENARIOS.length + 1);
  });
});

describe("scheduled scanning", () => {
  test("the job schedules due wallets once and skips recently attempted ones", async () => {
    vi.useFakeTimers();
    const { t, walletId } = await setup();
    const second = await t.mutation(api.wallets.addWallet, { address: "0x" + "a".repeat(40) });
    succeedWith(ensRaw(Date.now() + 12 * DAY));

    const first = await t.mutation(internal.jobs.scanWallets.run, {});
    expect(first).toEqual({ scheduled: 2, skipped: 0 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const wallets = await t.query(api.wallets.getWallets, {});
    expect(wallets.map((w) => w.lastScanStatus)).toEqual(["ok", "ok"]);
    expect(wallets.find((w) => w._id === walletId)?.lastScannedAt).toBeDefined();
    expect(wallets.find((w) => w._id === second)?.lastScannedAt).toBeDefined();

    // Both wallets were just attempted → nothing is due.
    const rerun = await t.mutation(internal.jobs.scanWallets.run, {});
    expect(rerun).toEqual({ scheduled: 0, skipped: 2 });
    // Idempotent: only one live event exists for the first wallet.
    expect(
      (await t.run(async (ctx) => ctx.db.query("events").take(10))).filter((e) => !e.isDemo),
    ).toHaveLength(1);
  });
});
