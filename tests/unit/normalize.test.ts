import { describe, expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  discoverFixtureEvents,
  anchorTime,
  FIXTURE_SCENARIOS,
} from "../../convex/ingestion/fixtures";
import {
  normalizeRawEvent,
  type RawEventInput,
} from "../../convex/intelligence/normalize";
import { scorePriority } from "../../convex/intelligence/priority";
import { evaluateRelevance } from "../../convex/intelligence/relevance";

const WALLET = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const NOW = Date.UTC(2026, 8, 20, 9, 30); // 2026-09-20T09:30Z
const HOUR = 3_600_000;

const context = {
  userId: "user_1" as Id<"users">,
  walletId: "wallet_1" as Id<"wallets">,
  walletAddress: WALLET,
  protocolId: "protocol_1" as Id<"protocols">,
  now: NOW,
};

function byKind(kind: RawEventInput["payload"]["kind"]): RawEventInput {
  const raw = discoverFixtureEvents(WALLET, NOW).find((r) => r.payload.kind === kind);
  if (!raw) throw new Error(`missing fixture ${kind}`);
  return raw;
}

describe("fixture source", () => {
  test("produces one raw observation per scenario, all about the wallet", () => {
    const raws = discoverFixtureEvents(WALLET, NOW);
    expect(raws).toHaveLength(FIXTURE_SCENARIOS.length);
    expect(new Set(raws.map((r) => r.sourceEventId)).size).toBe(raws.length);
    for (const raw of raws) {
      expect(raw.isDemo).toBe(true);
      expect(raw.source).toBe("fixture");
      expect(raw.payload.wallet).toBe(WALLET);
    }
  });

  test("is byte-identical within the same hour", () => {
    const a = discoverFixtureEvents(WALLET, NOW).map((r) => r.payload);
    const b = discoverFixtureEvents(WALLET, NOW + 20 * 60_000).map((r) => r.payload);
    expect(a).toEqual(b);
    expect(anchorTime(NOW)).toBe(Date.UTC(2026, 8, 20, 9));
  });
});

describe("normalization", () => {
  test("ENS expiry → deadline event with a renew action and a 12-day deadline", () => {
    const event = normalizeRawEvent(byKind("ens_expiry"), context);
    expect(event.eventType).toBe("ens_expiry");
    expect(event.category).toBe("deadline");
    expect(event.requiresAction).toBe(true);
    expect(event.title).toBe("numa-demo.eth expires soon");
    expect(event.recommendedAction).toBe("Review and renew the registration");
    expect(event.deadline).toBe(anchorTime(NOW) + 12 * 24 * HOUR);
    expect(event.source.type).toBe("onchain");
    expect(event.isDemo).toBe(true);
    expect(event.dedupeKey).toBe(`user_1|${WALLET}|ens_expiry|ens|numa-demo.eth`);
    // 12 days out is the "month" stage → medium per the documented mapping.
    expect(event.metadata.expiryStage).toBe("month");
    expect(scorePriority(event.priorityFactors).severity).toBe("medium");
  });

  test("Aave health factor → high-severity warning keyed by risk bucket", () => {
    const event = normalizeRawEvent(byKind("position_risk"), context);
    expect(event.category).toBe("warning");
    expect(event.title).toBe("Aave V3 Ethereum health factor is 1.31");
    expect(event.summary).toContain("dropped from 1.53 to 1.31");
    expect(event.metadata.previousValue).toBe(1.53);
    expect(event.metadata.currentValue).toBe(1.31);
    expect(event.metadata.exposureUsd).toBe(8_400);
    expect(event.dedupeKey).toBe(`user_1|${WALLET}|position_risk|aave|hf:warning`);
    const priority = scorePriority(event.priorityFactors);
    expect(priority.severity).toBe("high");
    expect(priority.score).toBeCloseTo(0.7575, 4);
  });

  test("a metric move inside the same bucket keeps the dedupe key; a bucket change does not", () => {
    const raw = byKind("position_risk");
    if (raw.payload.kind !== "position_risk") throw new Error("unreachable");
    const same = normalizeRawEvent(
      { ...raw, payload: { ...raw.payload, healthFactor: 1.28, previousHealthFactor: 1.31 } },
      context,
    );
    const worse = normalizeRawEvent(
      { ...raw, payload: { ...raw.payload, healthFactor: 1.05 } },
      context,
    );
    const base = normalizeRawEvent(raw, context);
    expect(same.dedupeKey).toBe(base.dedupeKey);
    expect(same.title).not.toBe(base.title);
    expect(worse.dedupeKey).not.toBe(base.dedupeKey);
    expect(worse.category).toBe("security");
    expect(scorePriority(worse.priorityFactors).severity).toBe("critical");
  });

  test("governance deadline → medium governance event closing in 7h", () => {
    const event = normalizeRawEvent(byKind("governance_deadline"), context);
    expect(event.category).toBe("governance");
    expect(event.title).toMatch(/^Arbitrum proposal closes in \dh$/);
    expect(event.source.type).toBe("governance");
    expect(event.deadline).toBe(anchorTime(NOW) + 7 * HOUR);
    expect(scorePriority(event.priorityFactors).severity).toBe("medium");
  });

  test("bridge claim → action event with the withdrawal transaction", () => {
    const event = normalizeRawEvent(byKind("bridge_claim_ready"), context);
    expect(event.category).toBe("action");
    expect(event.title).toBe("0.5 ETH is ready to claim");
    expect(event.metadata.relatedTransaction).toMatch(/^0x/);
    expect(event.deadline).toBeUndefined();
    expect(event.occurredAt).toBeDefined();
    expect(scorePriority(event.priorityFactors).severity).toBe("medium");
  });

  test("protocol migration → update event from an official web source", () => {
    const event = normalizeRawEvent(byKind("protocol_migration"), context);
    expect(event.category).toBe("update");
    expect(event.source.type).toBe("official_web");
    expect(event.whyItMatters).toContain("$8,400");
    expect(scorePriority(event.priorityFactors).severity).toBe("medium");
  });

  test("never writes undefined into metadata", () => {
    for (const raw of discoverFixtureEvents(WALLET, NOW)) {
      const event = normalizeRawEvent(raw, context);
      expect(Object.values(event.metadata)).not.toContain(undefined);
      expect(event.metadata.rawSourceEventId).toBe(raw.sourceEventId);
    }
  });
});

describe("relevance", () => {
  const relevanceContext = { walletId: context.walletId, walletAddress: WALLET };

  test("an observation about this wallet is relevant", () => {
    const decision = evaluateRelevance(byKind("ens_expiry"), relevanceContext);
    expect(decision.relevant).toBe(true);
    expect(decision.affectedWalletIds).toEqual([context.walletId]);
  });

  test("an observation about another wallet is not", () => {
    const raw = byKind("ens_expiry");
    const decision = evaluateRelevance(
      { ...raw, payload: { ...raw.payload, wallet: "0x" + "1".repeat(40) } },
      relevanceContext,
    );
    expect(decision.relevant).toBe(false);
    expect(decision.reason).toMatch(/different wallet/);
  });

  test("a protocol announcement needs exposure to be relevant", () => {
    const raw = byKind("protocol_migration");
    if (raw.payload.kind !== "protocol_migration") throw new Error("unreachable");
    expect(evaluateRelevance(raw, relevanceContext).relevant).toBe(true);
    const none = evaluateRelevance(
      { ...raw, payload: { ...raw.payload, exposureUsd: 0 } },
      relevanceContext,
    );
    expect(none.relevant).toBe(false);
  });
});
