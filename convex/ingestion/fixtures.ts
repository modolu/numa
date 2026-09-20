/**
 * Deterministic demo fixtures (NUMA_ARCHITECTURE.md §34).
 *
 * This is a *source adapter*: it produces raw observations in exactly the
 * shape a live onchain/Firecrawl adapter will, so the fixtures exercise the
 * full pipeline (raw → normalize → relevance → priority → Convex → inbox)
 * instead of bypassing it. Nothing here calls an external service.
 *
 * Deadlines are anchored to the start of the current UTC hour so a re-run
 * within the same hour is byte-identical (and therefore provably a no-op),
 * while the demo still reads "closes in 7h" / "expires in 12 days".
 *
 * Wallet address is the only input; every generated payload is *about*
 * that wallet, so the relevance engine has a real decision to make.
 */
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import type { RawEventInput, RawEventPayload } from "../../lib/events/raw";
import { requireUser } from "../lib/identity";
import { requireOwnedWallet } from "../lib/access";
import { ingestRawEvents, type IngestSummary } from "./pipeline";

export const FIXTURE_SOURCE = "fixture";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;


export type FixtureScenario = {
  /** Stable id; becomes `rawEvents.sourceEventId`. */
  id: string;
  build: (wallet: string, anchor: number) => RawEventPayload;
};

/** Start of the current UTC hour: stable within the hour, fresh across days. */
export function anchorTime(now: number): number {
  return Math.floor(now / HOUR) * HOUR;
}

export const FIXTURE_SCENARIOS: readonly FixtureScenario[] = [
  {
    id: "ens-expiry:numa-demo.eth",
    build: (wallet, anchor) => ({
      kind: "ens_expiry",
      wallet,
      protocol: "ens",
      chainId: 1,
      name: "numa-demo.eth",
      expiresAt: anchor + 12 * DAY,
      gracePeriodEndsAt: anchor + 102 * DAY,
      relationship: "registrant",
      renewUrl: "https://app.ens.domains/numa-demo.eth",
      registrarContract: "0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85",
    }),
  },
  {
    id: "aave-v3-eth:health-factor",
    build: (wallet) => ({
      kind: "position_risk",
      wallet,
      protocol: "aave",
      chainId: 1,
      market: "Aave V3 Ethereum",
      healthFactor: 1.31,
      previousHealthFactor: 1.53,
      collateralUsd: 8_400,
      debtUsd: 5_100,
      collateralAsset: "ETH",
      debtAsset: "USDC",
      positionUrl: "https://app.aave.com/",
      poolContract: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
    }),
  },
  {
    id: "arbitrum-dao:proposal-441",
    build: (wallet, anchor) => ({
      kind: "governance_deadline",
      wallet,
      protocol: "arbitrum-dao",
      chainId: 42161,
      daoName: "Arbitrum",
      proposalId: "441",
      proposalTitle: "AIP: Adjust Security Council election timeline",
      votingEndsAt: anchor + 7 * HOUR,
      votingPower: 1_250,
      votingPowerSymbol: "ARB",
      voteUrl: "https://www.tally.xyz/gov/arbitrum",
      sourceUrl: "https://forum.arbitrum.foundation/",
    }),
  },
  {
    id: "arbitrum-bridge:withdrawal-0x9c1e",
    build: (wallet, anchor) => ({
      kind: "bridge_claim_ready",
      wallet,
      protocol: "arbitrum-bridge",
      chainId: 1,
      amount: 0.5,
      asset: "ETH",
      amountUsd: 1_620,
      withdrawalTxHash:
        "0x9c1e4f0b2a6d8e7c5b3a1f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c",
      readySince: anchor - 6 * HOUR,
      claimUrl: "https://bridge.arbitrum.io/",
    }),
  },
  {
    id: "aave:v2-wind-down-2026-09",
    build: (wallet, anchor) => ({
      kind: "protocol_migration",
      wallet,
      protocol: "aave",
      chainId: 1,
      announcementId: "aave-v2-eth-wind-down-2026-09",
      headline: "Aave V2 Ethereum market is winding down",
      details:
        "Aave governance approved reducing V2 Ethereum reserve caps and raising reserve factors ahead of deprecation. Positions should migrate to V3.",
      sourceUrl: "https://governance.aave.com/",
      migrateBy: anchor + 30 * DAY,
      exposureUsd: 8_400,
      migrationUrl: "https://app.aave.com/migration/",
    }),
  },
];

/** Adapter-style discovery: raw observations for one wallet. */
export function discoverFixtureEvents(
  walletAddress: string,
  now: number,
): RawEventInput[] {
  const anchor = anchorTime(now);
  return FIXTURE_SCENARIOS.map((scenario) => ({
    source: FIXTURE_SOURCE,
    sourceEventId: scenario.id,
    observedAt: now,
    payload: scenario.build(walletAddress, anchor),
    isDemo: true,
  }));
}

/**
 * Development/demo seed: run every fixture through the real ingestion
 * pipeline for one of the caller's wallets. Safe to re-run — repeated
 * ingestion updates or leaves existing inbox items instead of duplicating
 * them, and the returned summary shows which happened.
 */
export const seedDemoEvents = mutation({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, args): Promise<IngestSummary> => {
    const user = await requireUser(ctx);
    const wallet = await requireOwnedWallet(ctx, user._id, args.walletId);
    const now = Date.now();
    const rawEvents = discoverFixtureEvents(wallet.address, now);
    return await ingestRawEvents(ctx, { user, wallet, rawEvents, now });
  },
});

/**
 * Development/demo reset: remove the caller's inbox, tasks and raw
 * observations so the seed can be demonstrated from a clean state.
 */
export const resetDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    let removed = 0;
    for (const table of ["tasks", "events", "interpretations"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(500);
      for (const row of rows) {
        await ctx.db.delete(table, row._id);
        removed += 1;
      }
    }
    const wallets = await ctx.db
      .query("wallets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(50);
    for (const wallet of wallets) {
      const raws = await ctx.db
        .query("rawEvents")
        .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
        .take(500);
      for (const raw of raws) {
        await ctx.db.delete("rawEvents", raw._id);
        removed += 1;
      }
    }
    return { removed };
  },
});
