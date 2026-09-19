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
import type { RawEventInput } from "./normalize";

export type RelevanceContext = {
  walletId: Id<"wallets">;
  walletAddress: string;
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

  return {
    relevant: true,
    confidence: 1,
    reason: "Onchain observation is about this wallet",
    affectedWalletIds: [context.walletId],
  };
}
