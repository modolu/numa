/**
 * Relevance engine (NUMA_ARCHITECTURE.md §15).
 *
 * Input:  a normalized candidate + the user's wallet context.
 * Output: relevant? confidence, reason, affected wallets.
 *
 * This milestone is deterministic: an observation is relevant to a wallet
 * when the source says it is *about* that wallet, and an offchain protocol
 * announcement is relevant only when the wallet has exposure to the
 * protocol. OpenAI-assisted relevance for crawled content plugs in behind
 * the same `RelevanceDecision` contract later.
 */
import type { Id } from "../_generated/dataModel";
import { isWalletPayload, type RawEventInput } from "../../lib/events/raw";

export type SubscribedProtocol = {
  slug: string;
  origin: "live" | "demo";
};

export type RelevanceContext = {
  walletId: Id<"wallets">;
  walletAddress: string;
  /** Protocols this wallet is subscribed to — the offchain relevance gate (§15). */
  subscriptions?: SubscribedProtocol[];
};

export type RelevanceDecision = {
  relevant: boolean;
  confidence: number;
  reason: string;
  affectedWalletIds: Id<"wallets">[];
};

export function evaluateRelevance(
  raw: RawEventInput,
  context: RelevanceContext,
): RelevanceDecision {
  if (!isWalletPayload(raw.payload)) {
    // Offchain source change: relevant only through a protocol subscription.
    const subscription = context.subscriptions?.find(
      (s) => s.slug === raw.payload.protocol,
    );
    if (!subscription) {
      return {
        relevant: false,
        confidence: 1,
        reason: `No exposure to ${raw.payload.protocol} for this wallet`,
        affectedWalletIds: [],
      };
    }
    return {
      relevant: true,
      confidence: subscription.origin === "live" ? 0.9 : 0.6,
      reason:
        subscription.origin === "live"
          ? `Wallet has live exposure to ${raw.payload.protocol}`
          : `Demo-derived exposure to ${raw.payload.protocol} (not real wallet analysis)`,
      affectedWalletIds: [context.walletId],
    };
  }

  const target = raw.payload.wallet.toLowerCase();
  const wallet = context.walletAddress.toLowerCase();

  if (target !== wallet) {
    return {
      relevant: false,
      confidence: 1,
      reason: "Observation is about a different wallet",
      affectedWalletIds: [],
    };
  }

  if (raw.payload.kind === "protocol_migration") {
    if (raw.payload.exposureUsd <= 0) {
      return {
        relevant: false,
        confidence: 0.9,
        reason: "No exposure to the affected protocol market",
        affectedWalletIds: [],
      };
    }
    return {
      relevant: true,
      confidence: 0.9,
      reason: "Wallet has active exposure to the affected protocol",
      affectedWalletIds: [context.walletId],
    };
  }

  if (raw.payload.kind === "ens_expiry") {
    if (raw.payload.relationship === "primary_name") {
      return {
        relevant: true,
        confidence: 0.8,
        reason:
          "Name is the wallet's primary ENS name; the registration is held by another address",
        affectedWalletIds: [context.walletId],
      };
    }
    return {
      relevant: true,
      confidence: 1,
      reason: `Wallet holds the ENS registration (${raw.payload.relationship})`,
      affectedWalletIds: [context.walletId],
    };
  }

  return {
    relevant: true,
    confidence: 1,
    reason: "Onchain observation is about this wallet",
    affectedWalletIds: [context.walletId],
  };
}
