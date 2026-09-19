import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { modules } from "../../convex/test.setup";

const CHECKSUMMED = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const LOWER = CHECKSUMMED.toLowerCase();
const OTHER = "0x" + "a".repeat(40);

describe("wallets", () => {
  test("adding a wallet persists it lowercased as primary", async () => {
    const t = convexTest(schema, modules);
    const walletId = await t.mutation(api.wallets.addWallet, {
      address: CHECKSUMMED,
      label: "  Main  ",
    });
    const wallets = await t.query(api.wallets.getWallets, {});
    expect(wallets).toHaveLength(1);
    expect(wallets[0]._id).toBe(walletId);
    expect(wallets[0]).toMatchObject({
      address: LOWER,
      label: "Main",
      chainFamily: "evm",
      isPrimary: true,
    });
  });

  test("the same address in different casing is a duplicate", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.wallets.addWallet, { address: CHECKSUMMED });
    await expect(
      t.mutation(api.wallets.addWallet, { address: LOWER }),
    ).rejects.toThrow(/already being monitored/);
    expect(await t.query(api.wallets.getWallets, {})).toHaveLength(1);
  });

  test("invalid addresses are rejected server-side", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.wallets.addWallet, { address: "vitalik.eth" }),
    ).rejects.toThrow(/0x/);
    await expect(
      t.mutation(api.wallets.addWallet, { address: "0x123" }),
    ).rejects.toThrow(/42 characters/);
    expect(await t.query(api.wallets.getWallets, {})).toHaveLength(0);
  });

  test("only the first wallet is primary", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.wallets.addWallet, { address: CHECKSUMMED });
    await t.mutation(api.wallets.addWallet, { address: OTHER });
    const wallets = await t.query(api.wallets.getWallets, {});
    expect(wallets.map((w) => [w.address, w.isPrimary])).toEqual([
      [LOWER, true],
      [OTHER, false],
    ]);
  });

  test("wallets are scoped to their owner", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ tokenIdentifier: "test|alice", subject: "alice", issuer: "test" });
    const bob = t.withIdentity({ tokenIdentifier: "test|bob", subject: "bob", issuer: "test" });
    await alice.mutation(api.wallets.addWallet, { address: CHECKSUMMED });
    expect(await bob.query(api.wallets.getWallets, {})).toHaveLength(0);
    // Bob may monitor the same public address independently.
    await bob.mutation(api.wallets.addWallet, { address: CHECKSUMMED });
    expect(await bob.query(api.wallets.getWallets, {})).toHaveLength(1);
    expect(await alice.query(api.wallets.getWallets, {})).toHaveLength(1);
  });
});
