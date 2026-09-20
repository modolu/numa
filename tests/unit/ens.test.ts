import { describe, expect, test } from "vitest";
import {
  createEnsAdapter,
  ENS_BASE_REGISTRAR,
  ENS_GRACE_PERIOD_MS,
  ENS_NAME_WRAPPER,
  ensSourceEventId,
  ethSecondLevelLabel,
  mapEnsRegistrationToPayload,
  type EnsReader,
  type EnsRegistration,
} from "../../lib/onchain/ens";
import {
  ProviderError,
  sanitizeProviderMessage,
  toProviderError,
} from "../../lib/onchain/provider";
import {
  ENS_STAGE_FACTORS,
  ensExpiryFactors,
  ensExpiryStage,
  scorePriority,
} from "../../convex/intelligence/priority";

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const WALLET_LOWER = WALLET.toLowerCase();
const OTHER = "0x220866b1a2219f40e72f5c628b65d54268ca3a9d";
const DAY = 24 * 3_600_000;
const NOW = Date.UTC(2026, 8, 20, 9, 30);

function registration(overrides: Partial<EnsRegistration> = {}): EnsRegistration {
  return {
    expiresAtSeconds: BigInt(Math.floor((NOW + 12 * DAY) / 1000)),
    registrant: WALLET_LOWER,
    blockNumber: 26_000_000n,
    ...overrides,
  };
}

function fakeReader(overrides: Partial<EnsReader> = {}): EnsReader {
  return {
    label: "fake reader",
    getPrimaryName: async () => "numa-demo.eth",
    getRegistration: async () => registration(),
    ...overrides,
  };
}

describe("ENS name handling", () => {
  test("only .eth second-level names have a registrar expiry", () => {
    expect(ethSecondLevelLabel("vitalik.eth")).toBe("vitalik");
    expect(ethSecondLevelLabel("Vitalik.ETH")).toBe("vitalik");
    expect(ethSecondLevelLabel("sub.vitalik.eth")).toBeNull();
    expect(ethSecondLevelLabel("example.com")).toBeNull();
    expect(ethSecondLevelLabel(".eth")).toBeNull();
  });

  test("source event id is stable per wallet and name", () => {
    expect(ensSourceEventId(WALLET, "Vitalik.eth")).toBe(
      `ens:1:${WALLET_LOWER}:vitalik.eth`,
    );
  });
});

describe("ENS registration → raw payload", () => {
  test("registrant relationship when the wallet holds the NFT", () => {
    const payload = mapEnsRegistrationToPayload(WALLET, "Numa-Demo.eth", registration());
    expect(payload).toMatchObject({
      kind: "ens_expiry",
      wallet: WALLET_LOWER,
      protocol: "ens",
      chainId: 1,
      name: "numa-demo.eth",
      relationship: "registrant",
      registrant: undefined,
      renewUrl: "https://app.ens.domains/numa-demo.eth",
      registrarContract: ENS_BASE_REGISTRAR,
      observedBlock: 26_000_000,
    });
    expect(payload.expiresAt).toBe(Number(registration().expiresAtSeconds) * 1000);
    expect(payload.gracePeriodEndsAt).toBe(payload.expiresAt + ENS_GRACE_PERIOD_MS);
    expect(payload.tokenId).toMatch(/^\d+$/);
  });

  test("wrapped_owner relationship when the NameWrapper holds it for the wallet", () => {
    const payload = mapEnsRegistrationToPayload(
      WALLET,
      "numa-demo.eth",
      registration({ registrant: ENS_NAME_WRAPPER, wrappedOwner: WALLET_LOWER }),
    );
    expect(payload.relationship).toBe("wrapped_owner");
    expect(payload.registrant).toBeUndefined();
  });

  test("primary_name relationship records the actual holder", () => {
    const payload = mapEnsRegistrationToPayload(
      WALLET,
      "vitalik.eth",
      registration({ registrant: OTHER }),
    );
    expect(payload.relationship).toBe("primary_name");
    expect(payload.registrant).toBe(OTHER);
  });

  test("rejects malformed provider data instead of fabricating fields", () => {
    expect(() =>
      mapEnsRegistrationToPayload(WALLET, "numa-demo.eth", registration({ expiresAtSeconds: 0n })),
    ).toThrow(ProviderError);
    expect(() =>
      mapEnsRegistrationToPayload(
        WALLET,
        "numa-demo.eth",
        registration({ expiresAtSeconds: "soon" as unknown as bigint }),
      ),
    ).toThrow(/expiry/);
    expect(() =>
      mapEnsRegistrationToPayload(
        WALLET,
        "numa-demo.eth",
        registration({ registrant: "not-an-address" }),
      ),
    ).toThrow(/registrant/i);
    expect(() =>
      mapEnsRegistrationToPayload(WALLET, "sub.numa-demo.eth", registration()),
    ).toThrow(/Unsupported/);
  });
});

describe("ENS adapter", () => {
  const wallet = { address: WALLET_LOWER, chainFamily: "evm" as const };

  test("discovers the primary name as one live raw observation", async () => {
    const adapter = createEnsAdapter({ reader: fakeReader(), now: () => NOW });
    const result = await adapter.discover(wallet);
    expect(result.skipped).toEqual([]);
    expect(result.rawEvents).toHaveLength(1);
    expect(result.rawEvents[0]).toMatchObject({
      source: "ens",
      sourceEventId: `ens:1:${WALLET_LOWER}:numa-demo.eth`,
      observedAt: NOW,
      isDemo: false,
    });
    expect(result.rawEvents[0].payload.kind).toBe("ens_expiry");
  });

  test("wallet without a primary name yields nothing, with a reason", async () => {
    const adapter = createEnsAdapter({
      reader: fakeReader({ getPrimaryName: async () => null }),
    });
    const result = await adapter.discover(wallet);
    expect(result.rawEvents).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/No primary ENS name/);
  });

  test("non-.eth primary names are skipped, not fabricated", async () => {
    const adapter = createEnsAdapter({
      reader: fakeReader({ getPrimaryName: async () => "alice.example.com" }),
    });
    const result = await adapter.discover(wallet);
    expect(result.rawEvents).toEqual([]);
    expect(result.skipped[0].subject).toBe("alice.example.com");
  });

  test("network failures surface as transient ProviderErrors without URLs", async () => {
    const adapter = createEnsAdapter({
      reader: fakeReader({
        getPrimaryName: async () => {
          throw new Error("HTTP request failed.\nURL: https://rpc.example/v1/SECRET\nDetails: timeout");
        },
      }),
    });
    await expect(adapter.discover(wallet)).rejects.toMatchObject({
      name: "ProviderError",
      kind: "transient",
      source: "ens",
      message: "HTTP request failed.",
    });
  });

  test("4xx provider responses are permanent (not retried blindly)", async () => {
    const adapter = createEnsAdapter({
      reader: fakeReader({
        getRegistration: async () => {
          throw Object.assign(new Error("Forbidden"), { status: 403 });
        },
      }),
    });
    await expect(adapter.discover(wallet)).rejects.toMatchObject({
      kind: "permanent",
      status: 403,
    });
  });

  test("rate limiting stays retryable", () => {
    const err = toProviderError(Object.assign(new Error("Too many"), { status: 429 }), "ens");
    expect(err.kind).toBe("transient");
  });

  test("non-EVM wallets are skipped", async () => {
    const adapter = createEnsAdapter({ reader: fakeReader() });
    const result = await adapter.discover({
      address: WALLET_LOWER,
      chainFamily: "solana" as unknown as "evm",
    });
    expect(result.rawEvents).toEqual([]);
  });
});

describe("provider message sanitization", () => {
  test("prefers shortMessage, keeps one line, strips endpoints", () => {
    expect(
      sanitizeProviderMessage(
        Object.assign(new Error("long\nmulti\nline"), {
          shortMessage: "HTTP request failed. See https://rpc.example/key/abc123 for details",
        }),
      ),
    ).toBe("HTTP request failed. See [endpoint] for details");
    expect(sanitizeProviderMessage("plain string")).toBe("plain string");
    expect(sanitizeProviderMessage(new Error(""))).toBe("Provider request failed");
    expect(sanitizeProviderMessage(new Error("x".repeat(500))).length).toBe(200);
  });
});

describe("ENS priority factors", () => {
  const at = (ms: number) => ensExpiryStage(NOW + ms, NOW);

  test("stage boundaries follow the documented mapping", () => {
    expect(at(-1)).toBe("expired");
    expect(at(0)).toBe("expired");
    expect(at(1)).toBe("imminent");
    expect(at(3 * DAY)).toBe("imminent");
    expect(at(3 * DAY + 1)).toBe("week");
    expect(at(7 * DAY)).toBe("week");
    expect(at(7 * DAY + 1)).toBe("month");
    expect(at(30 * DAY)).toBe("month");
    expect(at(30 * DAY + 1)).toBe("quarter");
    expect(at(90 * DAY)).toBe("quarter");
    expect(at(90 * DAY + 1)).toBe("later");
  });

  test("factors feed the shared weighted score and land at documented severities", () => {
    const severity = (ms: number) =>
      scorePriority(ensExpiryFactors(NOW + ms, NOW, 0.95)).severity;
    expect(severity(-DAY)).toBe("high");
    expect(severity(2 * DAY)).toBe("high");
    expect(severity(5 * DAY)).toBe("medium");
    expect(severity(12 * DAY)).toBe("medium");
    expect(severity(60 * DAY)).toBe("low");
    expect(severity(400 * DAY)).toBe("low");
    expect(scorePriority(ensExpiryFactors(NOW - DAY, NOW, 0.95)).score).toBeCloseTo(0.725, 3);
    expect(scorePriority(ensExpiryFactors(NOW + 12 * DAY, NOW, 0.95)).score).toBeCloseTo(0.485, 3);
  });

  test("urgency never decreases as expiry gets closer", () => {
    const stages = ["later", "quarter", "month", "week", "imminent", "expired"] as const;
    for (let i = 1; i < stages.length; i++) {
      expect(ENS_STAGE_FACTORS[stages[i]].urgency).toBeGreaterThanOrEqual(
        ENS_STAGE_FACTORS[stages[i - 1]].urgency,
      );
    }
  });

  test("a primary-name-only relationship lowers confidence, not urgency", () => {
    const own = scorePriority(ensExpiryFactors(NOW + DAY, NOW, 0.95));
    const primary = scorePriority(ensExpiryFactors(NOW + DAY, NOW, 0.8));
    expect(primary.factors.urgency).toBe(own.factors.urgency);
    expect(primary.score).toBeLessThan(own.score);
  });
});
