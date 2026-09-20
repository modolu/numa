/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { modules } from "../../convex/test.setup";
import { OFFICIAL_SOURCES } from "../../convex/sources";
import { KNOWN_PROTOCOLS } from "../../convex/protocols";
import { FIXTURE_SCENARIOS } from "../../convex/ingestion/fixtures";
import type { RawEventInput } from "../../lib/events/raw";
import { ProviderError } from "../../lib/providers/errors";
import type { ScrapedSource, WebSourceAdapter } from "../../lib/web/provider";
import { normalizeContent } from "../../lib/web/normalizeContent";
import { hashContent } from "../../lib/web/hashContent";

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const WALLET_LOWER = WALLET.toLowerCase();
const DAY = 24 * 3_600_000;

/** Controllable fake web adapter: `state.pages[url]` is what a scrape returns. */
const state = vi.hoisted(() => ({
  pages: {} as Record<string, string>,
  fail: null as null | (() => never),
  calls: [] as string[],
}));

vi.mock("../../convex/ingestion/webAdapters", () => ({
  createWebSourceAdapter: (): WebSourceAdapter => ({
    provider: "firecrawl",
    providerLabel: "fake firecrawl",
    scrape: async (source): Promise<ScrapedSource> => {
      state.calls.push(source.url);
      if (state.fail) state.fail();
      const content = state.pages[source.url];
      if (content === undefined) throw new ProviderError("no fake page", "malformed", "firecrawl");
      return { content, title: `Title of ${source.url}`, statusCode: 200, fetchedAt: Date.now() };
    },
  }),
}));

// Fake onchain adapter so the ENS-derived (live) subscription path is testable offline.
const onchain = vi.hoisted(() => ({ rawEvents: [] as RawEventInput[] }));
vi.mock("../../convex/ingestion/adapters", () => ({
  createAdapters: () => [
    { source: "ens", providerLabel: "fake ens", discover: async () => ({ rawEvents: onchain.rawEvents, skipped: [] }) },
  ],
}));

const AAVE_GOV = "https://governance.aave.com/";
const ENS_DOCS = "https://docs.ens.domains/";

function ensRaw(): RawEventInput {
  const expiresAt = Date.now() + 12 * DAY;
  return {
    source: "ens",
    sourceEventId: `ens:1:${WALLET_LOWER}:numa-live.eth`,
    observedAt: Date.now(),
    isDemo: false,
    payload: {
      kind: "ens_expiry", wallet: WALLET_LOWER, protocol: "ens", chainId: 1, name: "numa-live.eth",
      expiresAt, gracePeriodEndsAt: expiresAt + 90 * DAY, relationship: "registrant", tokenId: "1",
      renewUrl: "https://app.ens.domains/numa-live.eth", registrarContract: "0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85",
    },
  };
}

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.sources.seedSources, {});
  const sources = await t.run(async (ctx) => ctx.db.query("protocolSources").take(50));
  const byUrl = Object.fromEntries(sources.map((s) => [s.url, s._id])) as Record<string, Id<"protocolSources">>;
  return { t, byUrl };
}

async function crawl(t: ReturnType<typeof convexTest>, sourceId: Id<"protocolSources">) {
  return await t.action(internal.ingestion.firecrawl.crawlProtocolSource, { sourceId });
}

beforeEach(() => {
  state.pages = {};
  state.fail = null;
  state.calls = [];
  onchain.rawEvents = [];
  for (const s of OFFICIAL_SOURCES) state.pages[s.url] = `# ${s.protocolSlug} ${s.sourceType}\n\nBaseline content.`;
});
afterEach(() => vi.useRealTimers());

describe("registry seeding", () => {
  test("protocols and sources seed idempotently and validate hosts", async () => {
    const { t } = await setup();
    const again = await t.mutation(internal.sources.seedSources, {});
    expect(again).toMatchObject({ inserted: 0, unchanged: OFFICIAL_SOURCES.length, rejected: [] });
    const protocols = await t.mutation(internal.protocols.seedProtocols, {});
    expect(protocols).toEqual({ inserted: 0, updated: 0, unchanged: KNOWN_PROTOCOLS.length });
    expect(await t.run(async (ctx) => ctx.db.query("protocols").take(50))).toHaveLength(KNOWN_PROTOCOLS.length);
    expect(await t.run(async (ctx) => ctx.db.query("protocolSources").take(50))).toHaveLength(OFFICIAL_SOURCES.length);
    const list = await t.run(async (ctx) => ctx.db.query("protocolSources").take(50));
    expect(list.every((s) => s.url.startsWith("https://") && s.isActive)).toBe(true);
    // The registry seeds through the same validator that rejects foreign hosts.
    expect(list.map((s) => new URL(s.url).hostname).sort()).toEqual(
      ["aave.com", "docs.arbitrum.io", "docs.ens.domains", "ens.domains", "forum.arbitrum.foundation", "governance.aave.com"],
    );
  });
});

describe("crawl → normalize → hash → change detection", () => {
  test("first crawl establishes a baseline without a change event", async () => {
    const { t, byUrl } = await setup();
    const result = await crawl(t, byUrl[AAVE_GOV]);
    expect(result).toMatchObject({ status: "ok", changed: false, baseline: true, provider: "firecrawl" });
    const source = await t.run(async (ctx) => ctx.db.get("protocolSources", byUrl[AAVE_GOV]));
    expect(source?.contentHash).toBe(await hashContent(normalizeContent(state.pages[AAVE_GOV])));
    expect(source?.latestContent).toContain("Baseline content.");
    expect(source?.latestTitle).toBe(`Title of ${AAVE_GOV}`);
    expect(source?.lastCrawlStatus).toBe("ok");
    expect(source?.lastChangedAt).toBeUndefined();
    expect(await t.run(async (ctx) => ctx.db.query("rawEvents").take(10))).toHaveLength(0);
  });

  test("unchanged content (even with whitespace noise) does no further work", async () => {
    const { t, byUrl } = await setup();
    await crawl(t, byUrl[AAVE_GOV]);
    const before = await t.run(async (ctx) => ctx.db.get("protocolSources", byUrl[AAVE_GOV]));
    state.pages[AAVE_GOV] = state.pages[AAVE_GOV].replace("\n\n", "\r\n\r\n\r\n") + "   \n";
    const result = await crawl(t, byUrl[AAVE_GOV]);
    expect(result).toMatchObject({ status: "ok", changed: false, baseline: false });
    const after = await t.run(async (ctx) => ctx.db.get("protocolSources", byUrl[AAVE_GOV]));
    expect(after?.contentHash).toBe(before?.contentHash);
    expect(after?.previousContentHash).toBeUndefined();
    expect(after?.lastCrawledAt).toBeGreaterThanOrEqual(before!.lastCrawledAt!);
    expect(await t.run(async (ctx) => ctx.db.query("rawEvents").take(10))).toHaveLength(0);
  });

  test("changed content creates an auditable raw change record with a deterministic id", async () => {
    const { t, byUrl } = await setup();
    await crawl(t, byUrl[AAVE_GOV]);
    const previous = (await t.run(async (ctx) => ctx.db.get("protocolSources", byUrl[AAVE_GOV])))!.contentHash!;
    state.pages[AAVE_GOV] = "# aave governance\n\nNew proposal: AIP-999 posted.";
    const result = await crawl(t, byUrl[AAVE_GOV]);
    expect(result).toMatchObject({ status: "ok", changed: true });
    const raws = await t.run(async (ctx) => ctx.db.query("rawEvents").take(10));
    expect(raws).toHaveLength(1);
    const expectedHash = await hashContent(normalizeContent(state.pages[AAVE_GOV]));
    expect(raws[0]).toMatchObject({
      source: "firecrawl",
      sourceEventId: `firecrawl:${byUrl[AAVE_GOV]}:${expectedHash}`,
      processingStatus: "irrelevant", // nobody subscribed yet
    });
    expect(raws[0].walletId).toBeUndefined();
    expect(raws[0].payload).toMatchObject({
      kind: "protocol_update", protocol: "aave", sourceUrl: AAVE_GOV, sourceType: "governance",
      previousHash: previous, currentHash: expectedHash, contentLength: normalizeContent(state.pages[AAVE_GOV]).length,
    });
    expect(String(raws[0].payload.excerpt)).toContain("AIP-999");
    const source = await t.run(async (ctx) => ctx.db.get("protocolSources", byUrl[AAVE_GOV]));
    expect(source).toMatchObject({ previousContentHash: previous, contentHash: expectedHash });
    expect(source?.lastChangedAt).toBeDefined();
  });
});

describe("subscriptions and the relevance prefilter", () => {
  test("subscriptions derive from existing evidence and distinguish live vs demo", async () => {
    const { t } = await setup();
    const walletId = await t.mutation(api.wallets.addWallet, { address: WALLET });
    expect(await t.query(api.subscriptions.getSubscriptions, {})).toEqual([]);

    await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
    let subs = await t.query(api.subscriptions.getSubscriptions, {});
    expect(subs.map((s) => [s.protocol.slug, s.origin]).sort()).toEqual([
      ["aave", "demo"], ["arbitrum-bridge", "demo"], ["arbitrum-dao", "demo"], ["ens", "demo"],
    ]);
    expect(subs.find((s) => s.protocol.slug === "aave")?.evidence.sort()).toEqual(["position_risk", "protocol_migration"]);

    // A live ENS observation upgrades the ENS subscription to live; Aave stays demo.
    onchain.rawEvents = [ensRaw()];
    await t.action(api.ingestion.wallet.scanWallet, { walletId });
    subs = await t.query(api.subscriptions.getSubscriptions, {});
    expect(subs.find((s) => s.protocol.slug === "ens")).toMatchObject({ origin: "live", confidence: 1 });
    expect(subs.find((s) => s.protocol.slug === "aave")).toMatchObject({ origin: "demo", confidence: 0.5 });
    // Idempotent: re-seeding neither duplicates nor downgrades.
    await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
    const rows = await t.run(async (ctx) => ctx.db.query("userProtocolSubscriptions").take(50));
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.evidence.includes("ens_expiry"))?.origin).toBe("live");
  });

  test("a change on an unsubscribed protocol never reaches the inbox; a subscribed one does", async () => {
    const { t, byUrl } = await setup();
    const walletId = await t.mutation(api.wallets.addWallet, { address: WALLET });
    onchain.rawEvents = [ensRaw()];
    await t.action(api.ingestion.wallet.scanWallet, { walletId }); // live ENS exposure only
    await crawl(t, byUrl[AAVE_GOV]);
    await crawl(t, byUrl[ENS_DOCS]);

    state.pages[AAVE_GOV] += "\n\nAave changed.";
    const aave = await crawl(t, byUrl[AAVE_GOV]);
    expect(aave).toMatchObject({ status: "ok", changed: true, fanout: { users: 0, promoted: 0 } });
    let inbox = await t.query(api.events.getInbox, {});
    expect(inbox.attention.filter((e) => e.eventType === "protocol_update")).toHaveLength(0);
    expect((await t.run(async (ctx) => ctx.db.query("rawEvents").take(20))).filter((r) => r.source === "firecrawl")).toHaveLength(1);

    state.pages[ENS_DOCS] += "\n\nENS docs changed.";
    const ens = await crawl(t, byUrl[ENS_DOCS]);
    expect(ens).toMatchObject({ status: "ok", changed: true, fanout: { users: 1, promoted: 1, created: 1 } });
    inbox = await t.query(api.events.getInbox, {});
    const update = inbox.attention.find((e) => e.eventType === "protocol_update")!;
    expect(update).toMatchObject({
      title: "ENS official documentation source updated",
      category: "update", severity: "info", requiresAction: false, isDemo: false,
      sourceType: "official_web", sourceUrl: ENS_DOCS, walletId, status: "unread",
    });
    expect(update.metadata).toMatchObject({ exposureOrigin: "live", interpreted: false });
    expect(String(update.metadata.relevanceReason)).toMatch(/live exposure to ens/);
    expect(update.whyItMatters).toBe("You interact with ENS, so Numa is monitoring its official updates.");
    // Info-level updates create no task.
    expect((await t.query(api.tasks.getTasks, {})).open.every((task) => task.eventId !== update._id)).toBe(true);
    // Inbox order: the medium ENS expiry outranks the info update.
    expect(inbox.attention[0].eventType).toBe("ens_expiry");
    // Detail joins the protocol and source provenance.
    const detail = await t.query(api.events.getEvent, { eventId: update._id });
    expect(detail?.protocol?.name).toBe("ENS");
    expect(detail?.source).toMatchObject({ url: ENS_DOCS, sourceType: "docs" });
  });

  test("demo-derived exposure is honoured but labelled", async () => {
    const { t, byUrl } = await setup();
    const walletId = await t.mutation(api.wallets.addWallet, { address: WALLET });
    await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
    await crawl(t, byUrl[AAVE_GOV]);
    state.pages[AAVE_GOV] += "\n\nchanged";
    await crawl(t, byUrl[AAVE_GOV]);
    const update = (await t.query(api.events.getInbox, {})).attention.find((e) => e.eventType === "protocol_update")!;
    expect(update.whyItMatters).toMatch(/demo inbox includes Aave exposure/);
    expect(update.metadata.exposureOrigin).toBe("demo");
    expect(String(update.metadata.relevanceReason)).toMatch(/Demo-derived/);
    expect(update.isDemo).toBe(false); // the page change itself is real
  });
});

describe("dedupe and state preservation", () => {
  async function subscribedSetup() {
    const { t, byUrl } = await setup();
    const walletId = await t.mutation(api.wallets.addWallet, { address: WALLET });
    onchain.rawEvents = [ensRaw()];
    await t.action(api.ingestion.wallet.scanWallet, { walletId });
    await crawl(t, byUrl[ENS_DOCS]);
    return { t, byUrl, walletId };
  }
  const updates = async (t: ReturnType<typeof convexTest>) =>
    (await t.run(async (ctx) => ctx.db.query("events").take(50))).filter((e) => e.eventType === "protocol_update");

  test("reprocessing the same content version creates no duplicate and keeps user state", async () => {
    const { t, byUrl } = await subscribedSetup();
    const baselineHash = (await t.run(async (ctx) => ctx.db.get("protocolSources", byUrl[ENS_DOCS])))!.contentHash!;
    state.pages[ENS_DOCS] += "\n\nv2";
    await crawl(t, byUrl[ENS_DOCS]);
    const [event] = await updates(t);
    await t.mutation(api.events.markRead, { eventId: event._id });

    // Simulate a retry of the same version (e.g. the persist step re-ran):
    // roll the stored hash back to the baseline and crawl v2 again.
    await t.run(async (ctx) => ctx.db.patch("protocolSources", byUrl[ENS_DOCS], { contentHash: baselineHash }));
    const retry = await crawl(t, byUrl[ENS_DOCS]);
    expect(retry).toMatchObject({ status: "ok", changed: true, fanout: { promoted: 1, created: 0, unchanged: 1 } });
    expect(await updates(t)).toHaveLength(1);
    expect((await t.run(async (ctx) => ctx.db.query("rawEvents").take(50))).filter((r) => r.source === "firecrawl")).toHaveLength(1);
    expect((await t.query(api.events.getEvent, { eventId: event._id }))?.event.status).toBe("read");
  });

  test("a genuinely new content version is a distinct update", async () => {
    const { t, byUrl } = await subscribedSetup();
    state.pages[ENS_DOCS] += "\n\nv2";
    await crawl(t, byUrl[ENS_DOCS]);
    state.pages[ENS_DOCS] += "\n\nv3";
    await crawl(t, byUrl[ENS_DOCS]);
    const all = await updates(t);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((e) => e.dedupeKey)).size).toBe(2);
    expect((await t.run(async (ctx) => ctx.db.query("rawEvents").take(50))).filter((r) => r.source === "firecrawl")).toHaveLength(2);
  });
});

describe("failure handling", () => {
  test("transient failure keeps hash, content, last success and events; recovery clears it", async () => {
    const { t, byUrl } = await setup();
    const walletId = await t.mutation(api.wallets.addWallet, { address: WALLET });
    onchain.rawEvents = [ensRaw()];
    await t.action(api.ingestion.wallet.scanWallet, { walletId });
    await crawl(t, byUrl[ENS_DOCS]);
    state.pages[ENS_DOCS] += "\n\nchanged";
    await crawl(t, byUrl[ENS_DOCS]);
    const before = (await t.run(async (ctx) => ctx.db.get("protocolSources", byUrl[ENS_DOCS])))!;

    state.fail = () => { throw new Error("HTTP 503 from https://api.firecrawl.dev/v2/scrape Authorization: Bearer fc-secret123456"); };
    const failed = await crawl(t, byUrl[ENS_DOCS]);
    expect(failed).toMatchObject({ status: "failed", kind: "transient", retryable: true, error: "firecrawl: HTTP 503 from [endpoint] Authorization: Bearer [redacted]" });
    const after = (await t.run(async (ctx) => ctx.db.get("protocolSources", byUrl[ENS_DOCS])))!;
    expect(after).toMatchObject({ lastCrawlStatus: "failed", contentHash: before.contentHash, latestContent: before.latestContent, lastCrawledAt: before.lastCrawledAt });
    expect(after.lastCrawlError).not.toMatch(/secret/);
    expect((await t.query(api.events.getInbox, {})).attention.some((e) => e.eventType === "protocol_update")).toBe(true);

    state.fail = null;
    const recovered = await crawl(t, byUrl[ENS_DOCS]);
    expect(recovered).toMatchObject({ status: "ok", changed: false });
    const healthy = (await t.run(async (ctx) => ctx.db.get("protocolSources", byUrl[ENS_DOCS])))!;
    expect(healthy.lastCrawlStatus).toBe("ok");
    expect(healthy.lastCrawlError).toBeUndefined();
  });

  test("auth/permanent failures are not retryable and are recorded sanitized", async () => {
    const { t, byUrl } = await setup();
    state.fail = () => { throw Object.assign(new Error("Unauthorized: Invalid token"), { status: 401 }); };
    const result = await crawl(t, byUrl[ENS_DOCS]);
    expect(result).toMatchObject({ status: "failed", kind: "permanent", retryable: false });
    const source = await t.run(async (ctx) => ctx.db.get("protocolSources", byUrl[ENS_DOCS]));
    expect(source).toMatchObject({ lastCrawlStatus: "failed", lastCrawlError: "firecrawl: Unauthorized: Invalid token" });
    expect(source?.contentHash).toBeUndefined();
  });

  test("malformed provider output is a failure, not a change", async () => {
    const { t, byUrl } = await setup();
    await crawl(t, byUrl[ENS_DOCS]);
    delete state.pages[ENS_DOCS];
    const result = await crawl(t, byUrl[ENS_DOCS]);
    expect(result).toMatchObject({ status: "failed", kind: "malformed" });
    expect(await t.run(async (ctx) => ctx.db.query("rawEvents").take(10))).toHaveLength(0);
  });
});

describe("manual refresh and scheduling", () => {
  test("refresh requires a caller with an account, crawls only registry sources, and honours cooldowns", async () => {
    const { t } = await setup();
    await expect(t.action(api.ingestion.firecrawl.refreshSources, {})).rejects.toThrow(/Add a wallet/);
    await t.mutation(api.wallets.addWallet, { address: WALLET });
    const first = await t.action(api.ingestion.firecrawl.refreshSources, {});
    expect(first).toMatchObject({ checked: OFFICIAL_SOURCES.length, baseline: OFFICIAL_SOURCES.length, changed: 0, failed: 0 });
    expect(new Set(state.calls)).toEqual(new Set(OFFICIAL_SOURCES.map((s) => s.url)));
    const second = await t.action(api.ingestion.firecrawl.refreshSources, {});
    expect(second).toMatchObject({ checked: 0, skipped: OFFICIAL_SOURCES.length });
  });

  test("the job schedules only sources due under their policy, without concurrent duplicates", async () => {
    vi.useFakeTimers();
    const { t, byUrl } = await setup();
    const first = await t.mutation(internal.jobs.crawlSources.run, {});
    expect(first).toEqual({ scheduled: OFFICIAL_SOURCES.length, skipped: 0 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const sources = await t.run(async (ctx) => ctx.db.query("protocolSources").take(50));
    expect(sources.every((s) => s.lastCrawlStatus === "ok" && s.contentHash)).toBe(true);

    const rerun = await t.mutation(internal.jobs.crawlSources.run, {});
    expect(rerun).toEqual({ scheduled: 0, skipped: OFFICIAL_SOURCES.length });

    // A governance source becomes due after 30 minutes; docs (6h) does not.
    await t.run(async (ctx) => {
      await ctx.db.patch("protocolSources", byUrl[AAVE_GOV], { lastCrawlAttemptAt: Date.now() - 31 * 60_000 });
      await ctx.db.patch("protocolSources", byUrl[ENS_DOCS], { lastCrawlAttemptAt: Date.now() - 31 * 60_000 });
    });
    expect(await t.mutation(internal.jobs.crawlSources.run, {})).toEqual({ scheduled: 1, skipped: OFFICIAL_SOURCES.length - 1 });
    // A crawl marked running is not scheduled again.
    await t.run(async (ctx) => ctx.db.patch("protocolSources", byUrl[AAVE_GOV], { lastCrawlStatus: "running", lastCrawlAttemptAt: Date.now() }));
    expect(await t.mutation(internal.jobs.crawlSources.run, {})).toEqual({ scheduled: 0, skipped: OFFICIAL_SOURCES.length });
  });
});

describe("regression: fixtures and ENS are unaffected", () => {
  test("seeding fixtures and scanning ENS still behave as before", async () => {
    const { t } = await setup();
    const walletId = await t.mutation(api.wallets.addWallet, { address: WALLET });
    const seed = await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId });
    expect(seed.created).toBe(FIXTURE_SCENARIOS.length);
    expect((await t.mutation(api.ingestion.fixtures.seedDemoEvents, { walletId })).unchanged).toBe(FIXTURE_SCENARIOS.length);
    onchain.rawEvents = [ensRaw()];
    const scan = await t.action(api.ingestion.wallet.scanWallet, { walletId });
    expect(scan.status).toBe("ok");
    expect((await t.query(api.events.getInbox, {})).attention).toHaveLength(FIXTURE_SCENARIOS.length + 1);
  });
});
