/**
 * Wallet scanning (NUMA_ARCHITECTURE.md §8, §12.1, §28, §30).
 *
 *   validate ownership → call onchain adapters (action, network) →
 *   persist rawEvents + run normalize/relevance/priority/upsert (mutation) →
 *   persist scan status on the wallet.
 *
 * Network calls happen only in the action. All persistence goes through
 * internal mutations so it stays transactional and idempotent. A failed
 * provider call records the failure on the wallet and leaves every existing
 * event and raw observation untouched.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../_generated/server";
import { isRawEventInput, type RawEventInput } from "../../lib/events/raw";
import { toProviderError, type ProviderErrorKind } from "../../lib/onchain/provider";
import { getCurrentUser } from "../lib/identity";
import { createAdapters } from "./adapters";
import { ingestRawEvents, type IngestSummary } from "./pipeline";

/** Minimum gap between scans of one wallet triggered by the UI. */
export const MANUAL_SCAN_COOLDOWN_MS = 15_000;
/** A scan still marked "running" after this long is treated as abandoned. */
const RUNNING_STALE_MS = 2 * 60_000;

export type ScanResult =
  | {
      status: "ok";
      walletId: Id<"wallets">;
      providers: string[];
      skipped: { subject: string; reason: string }[];
      summary: IngestSummary;
      rejected: number;
    }
  | {
      status: "failed";
      walletId: Id<"wallets">;
      providers: string[];
      error: string;
      kind: ProviderErrorKind;
      retryable: boolean;
    }
  | { status: "skipped"; walletId: Id<"wallets">; reason: string };

const rawEventInputValidator = v.object({
  source: v.string(),
  sourceEventId: v.string(),
  observedAt: v.number(),
  payload: v.any(),
  isDemo: v.boolean(),
});

// ---------------------------------------------------------------------------
// Internal persistence
// ---------------------------------------------------------------------------

/** Ownership check for the public action; identity flows into the query. */
export const getOwnedWalletForScan = internalQuery({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, args): Promise<Doc<"wallets"> | null> => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const wallet = await ctx.db.get("wallets", args.walletId);
    return wallet && wallet.userId === user._id ? wallet : null;
  },
});

/** Unchecked lookup for scheduled scans (no caller identity). */
export const getWalletForScheduledScan = internalQuery({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, args): Promise<Doc<"wallets"> | null> => {
    return await ctx.db.get("wallets", args.walletId);
  },
});

/**
 * Claim the scan. Returns false when another scan is running or the manual
 * cooldown has not elapsed, so rapid repeat submissions are cheap no-ops.
 */
export const markScanStarted = internalMutation({
  args: { walletId: v.id("wallets"), now: v.number(), manual: v.boolean() },
  handler: async (ctx, args): Promise<{ started: boolean; reason?: string }> => {
    const wallet = await ctx.db.get("wallets", args.walletId);
    if (!wallet) return { started: false, reason: "Wallet not found" };
    const attempt = wallet.lastScanAttemptAt ?? 0;
    if (
      wallet.lastScanStatus === "running" &&
      args.now - attempt < RUNNING_STALE_MS
    ) {
      return { started: false, reason: "A scan is already running" };
    }
    if (args.manual && args.now - attempt < MANUAL_SCAN_COOLDOWN_MS) {
      return { started: false, reason: "Scanned a moment ago — try again shortly" };
    }
    await ctx.db.patch("wallets", wallet._id, {
      lastScanAttemptAt: args.now,
      lastScanStatus: "running",
    });
    return { started: true };
  },
});

/** Persist adapter output through the shared pipeline. */
export const ingestScanResults = internalMutation({
  args: {
    walletId: v.id("wallets"),
    rawEvents: v.array(rawEventInputValidator),
    now: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ summary: IngestSummary; rejected: number }> => {
    const wallet = await ctx.db.get("wallets", args.walletId);
    if (!wallet) throw new Error("Wallet not found");
    const user = await ctx.db.get("users", wallet.userId);
    if (!user) throw new Error("Wallet owner not found");

    // Defensive: adapters are trusted code, but anything crossing the
    // action→mutation boundary is re-validated before it touches the DB.
    const accepted: RawEventInput[] = [];
    let rejected = 0;
    for (const candidate of args.rawEvents) {
      if (isRawEventInput(candidate) && !candidate.isDemo) accepted.push(candidate);
      else rejected += 1;
    }

    const summary = await ingestRawEvents(ctx, {
      user,
      wallet,
      rawEvents: accepted,
      now: args.now,
    });
    await ctx.db.patch("wallets", wallet._id, {
      lastScannedAt: args.now,
      lastScanStatus: "ok",
      lastScanError: undefined,
    });
    return { summary, rejected };
  },
});

/** Record a provider failure without touching any event data. */
export const recordScanFailure = internalMutation({
  args: { walletId: v.id("wallets"), error: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const wallet = await ctx.db.get("wallets", args.walletId);
    if (!wallet) return null;
    await ctx.db.patch("wallets", wallet._id, {
      lastScanAttemptAt: args.now,
      lastScanStatus: "failed",
      lastScanError: args.error.slice(0, 300),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Scan orchestration (shared by the manual action and the scheduled job)
// ---------------------------------------------------------------------------

export async function performScan(
  ctx: ActionCtx,
  wallet: Doc<"wallets">,
  manual: boolean,
): Promise<ScanResult> {
  const now = Date.now();
  const claim = await ctx.runMutation(internal.ingestion.wallet.markScanStarted, {
    walletId: wallet._id,
    now,
    manual,
  });
  if (!claim.started) {
    return { status: "skipped", walletId: wallet._id, reason: claim.reason ?? "Skipped" };
  }

  const adapters = createAdapters();
  const providers = adapters.map((a) => a.providerLabel);
  const rawEvents: RawEventInput[] = [];
  const skipped: { subject: string; reason: string }[] = [];

  for (const adapter of adapters) {
    try {
      const result = await adapter.discover({
        address: wallet.address,
        chainFamily: wallet.chainFamily,
      });
      rawEvents.push(...result.rawEvents);
      skipped.push(...result.skipped);
    } catch (error) {
      const providerError = toProviderError(error, adapter.source);
      const message = `${adapter.source}: ${providerError.message}`;
      console.error("wallet scan failed", wallet._id, providerError.kind, message);
      await ctx.runMutation(internal.ingestion.wallet.recordScanFailure, {
        walletId: wallet._id,
        error: message,
        now: Date.now(),
      });
      return {
        status: "failed",
        walletId: wallet._id,
        providers,
        error: message,
        kind: providerError.kind,
        retryable: providerError.kind === "transient",
      };
    }
  }

  const { summary, rejected } = await ctx.runMutation(
    internal.ingestion.wallet.ingestScanResults,
    { walletId: wallet._id, rawEvents, now: Date.now() },
  );
  return { status: "ok", walletId: wallet._id, providers, skipped, summary, rejected };
}

/** User-triggered scan ("Refresh wallet"). Ownership is verified first. */
export const scanWallet = action({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, args): Promise<ScanResult> => {
    const wallet = await ctx.runQuery(internal.ingestion.wallet.getOwnedWalletForScan, {
      walletId: args.walletId,
    });
    if (!wallet) throw new ConvexError("Wallet not found");
    return await performScan(ctx, wallet, true);
  },
});

/** Scheduled scan for one wallet (invoked by jobs/scanWallets). */
export const runScheduledScan = internalAction({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, args): Promise<ScanResult> => {
    const wallet = await ctx.runQuery(internal.ingestion.wallet.getWalletForScheduledScan, {
      walletId: args.walletId,
    });
    if (!wallet) return { status: "skipped", walletId: args.walletId, reason: "Wallet not found" };
    return await performScan(ctx, wallet, false);
  },
});
