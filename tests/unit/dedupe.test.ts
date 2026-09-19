import { describe, expect, test } from "vitest";
import {
  buildDedupeKey,
  positionRiskExternalId,
  riskBucketForHealthFactor,
} from "../../convex/lib/dedupe";
import { contentHash, stableStringify } from "../../convex/lib/hash";

describe("dedupe keys", () => {
  const base = {
    userId: "user_1",
    walletAddress: "0xABC",
    eventType: "ens_expiry" as const,
    protocolSlug: "ens",
    externalId: "numa-demo.eth",
  };

  test("is deterministic and lowercases the wallet", () => {
    const a = buildDedupeKey(base);
    const b = buildDedupeKey({ ...base, walletAddress: "0xabc" });
    expect(a).toBe(b);
    expect(a).toBe("user_1|0xabc|ens_expiry|ens|numa-demo.eth");
  });

  test("changes when any component changes", () => {
    const key = buildDedupeKey(base);
    expect(buildDedupeKey({ ...base, userId: "user_2" })).not.toBe(key);
    expect(buildDedupeKey({ ...base, walletAddress: "0xdef" })).not.toBe(key);
    expect(buildDedupeKey({ ...base, eventType: "position_risk" })).not.toBe(key);
    expect(buildDedupeKey({ ...base, protocolSlug: "aave" })).not.toBe(key);
    expect(buildDedupeKey({ ...base, externalId: "other.eth" })).not.toBe(key);
  });

  test("uses a placeholder for missing wallet/protocol", () => {
    const key = buildDedupeKey({ ...base, walletAddress: null, protocolSlug: null });
    expect(key).toBe("user_1|-|ens_expiry|-|numa-demo.eth");
  });

  test("escapes the separator inside components", () => {
    const key = buildDedupeKey({ ...base, externalId: "a|b" });
    expect(key.split("|")).toHaveLength(5);
  });
});

describe("risk buckets", () => {
  test("maps health factors to stable buckets", () => {
    expect(riskBucketForHealthFactor(0.98)).toBe("critical");
    expect(riskBucketForHealthFactor(1.04)).toBe("critical");
    expect(riskBucketForHealthFactor(1.1)).toBe("danger");
    expect(riskBucketForHealthFactor(1.31)).toBe("warning");
    expect(riskBucketForHealthFactor(1.28)).toBe("warning");
    expect(riskBucketForHealthFactor(1.7)).toBe("watch");
    expect(riskBucketForHealthFactor(3)).toBe("healthy");
    expect(riskBucketForHealthFactor(Number.NaN)).toBe("critical");
  });

  test("small metric moves inside a bucket share an external id", () => {
    const a = positionRiskExternalId(riskBucketForHealthFactor(1.31));
    const b = positionRiskExternalId(riskBucketForHealthFactor(1.28));
    const c = positionRiskExternalId(riskBucketForHealthFactor(1.05));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBe("hf:warning");
  });
});

describe("content hash", () => {
  test("is independent of key order and undefined fields", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(
      stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }),
    );
    expect(contentHash({ a: 1, b: undefined })).toBe(contentHash({ a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});
