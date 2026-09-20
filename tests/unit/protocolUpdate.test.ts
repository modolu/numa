import { describe, expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { normalizeRawEvent } from "../../convex/intelligence/normalize";
import { PROTOCOL_UPDATE_FACTORS, scorePriority } from "../../convex/intelligence/priority";
import { evaluateRelevance } from "../../convex/intelligence/relevance";
import type { RawEventInput } from "../../lib/events/raw";

const WALLET = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const NOW = Date.UTC(2026, 8, 20, 9, 30);

const raw: RawEventInput = {
  source: "firecrawl",
  sourceEventId: "firecrawl:src1:abc",
  observedAt: NOW,
  isDemo: false,
  payload: {
    kind: "protocol_update",
    protocol: "aave",
    sourceId: "src1",
    sourceUrl: "https://governance.aave.com/",
    sourceType: "governance",
    previousHash: "aaa",
    currentHash: "bbb",
    title: "Aave Governance",
    excerpt: "New proposal posted",
    contentLength: 1234,
  },
};

const context = {
  userId: "user_1" as Id<"users">,
  walletId: "wallet_1" as Id<"wallets">,
  walletAddress: WALLET,
  protocolId: "protocol_1" as Id<"protocols">,
  protocolName: "Aave",
  now: NOW,
};

describe("generic protocol_update normalization", () => {
  test("is semantically neutral and non-actionable", () => {
    const event = normalizeRawEvent(raw, { ...context, exposureOrigin: "live" });
    expect(event).toMatchObject({
      eventType: "protocol_update",
      category: "update",
      requiresAction: false,
      title: "Aave official governance source updated",
      recommendedAction: "Review the source update",
      actionUrl: "https://governance.aave.com/",
      isDemo: false,
    });
    expect(event.summary).toMatch(/official monitored governance page changed/);
    expect(event.summary).toMatch(/not interpreted/);
    expect(event.whyItMatters).toBe("You interact with Aave, so Numa is monitoring its official updates.");
    expect(event.summary + event.whyItMatters).not.toMatch(/must migrate|funds are at risk|affects you/i);
    expect(event.source).toEqual({ type: "official_web", url: "https://governance.aave.com/", ref: "src1#bbb" });
    expect(event.metadata).toMatchObject({ sourceId: "src1", previousHash: "aaa", currentHash: "bbb", interpreted: false, exposureOrigin: "live" });
    expect(event.occurredAt).toBe(NOW);
    expect(event.dedupeKey).toBe(`user_1|${WALLET}|protocol_update|aave|src1:bbb`);
  });

  test("demo-derived exposure is labelled as such, never as wallet analysis", () => {
    const event = normalizeRawEvent(raw, { ...context, exposureOrigin: "demo" });
    expect(event.whyItMatters).toMatch(/demo inbox includes Aave exposure/);
    expect(event.metadata.exposureOrigin).toBe("demo");
  });

  test("a new content hash is a distinct logical update", () => {
    const a = normalizeRawEvent(raw, context);
    if (raw.payload.kind !== "protocol_update") throw new Error("unreachable");
    const b = normalizeRawEvent({ ...raw, payload: { ...raw.payload, currentHash: "ccc" } }, context);
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });

  test("priority stays at info: low urgency/action, no inferred exposure or security", () => {
    const event = normalizeRawEvent(raw, context);
    expect(event.priorityFactors).toEqual(PROTOCOL_UPDATE_FACTORS);
    expect(event.priorityFactors.financialExposure).toBe(0);
    expect(event.priorityFactors.securityImpact).toBe(0);
    const priority = scorePriority(event.priorityFactors);
    expect(priority.score).toBeCloseTo(0.145, 3);
    expect(priority.severity).toBe("info");
  });
});

describe("protocol_update relevance gate", () => {
  const base = { walletId: context.walletId, walletAddress: WALLET };
  test("no subscription → irrelevant", () => {
    expect(evaluateRelevance(raw, base)).toMatchObject({ relevant: false, reason: /No exposure to aave/ });
    expect(evaluateRelevance(raw, { ...base, subscriptions: [{ slug: "ens", origin: "live" }] }).relevant).toBe(false);
  });
  test("live subscription → relevant with high confidence; demo → lower, flagged", () => {
    expect(evaluateRelevance(raw, { ...base, subscriptions: [{ slug: "aave", origin: "live" }] }))
      .toMatchObject({ relevant: true, confidence: 0.9, affectedWalletIds: [context.walletId] });
    expect(evaluateRelevance(raw, { ...base, subscriptions: [{ slug: "aave", origin: "demo" }] }))
      .toMatchObject({ relevant: true, confidence: 0.6, reason: /Demo-derived/ });
  });
});
