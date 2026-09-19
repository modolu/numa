/**
 * Wallet model (NUMA_ARCHITECTURE.md §9, §25 Option A): read-only address
 * monitoring. No wallet connect, no signatures, nothing secret stored.
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { validateWalletAddress } from "../lib/validation/wallet";
import { getCurrentUser, requireUser } from "./lib/identity";

const MAX_WALLETS = 10;

export const getWallets = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const wallets = await ctx.db
      .query("wallets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_WALLETS);
    // Primary first, then oldest first.
    return wallets.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.createdAt - b.createdAt;
    });
  },
});

export const addWallet = mutation({
  args: { address: v.string(), label: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const validation = validateWalletAddress(args.address);
    if (!validation.ok) {
      throw new ConvexError(validation.reason);
    }
    const address = validation.address;
    const user = await requireUser(ctx);

    const duplicate = await ctx.db
      .query("wallets")
      .withIndex("by_user_and_address", (q) =>
        q.eq("userId", user._id).eq("address", address),
      )
      .unique();
    if (duplicate) {
      throw new ConvexError("That wallet is already being monitored.");
    }

    const existing = await ctx.db
      .query("wallets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_WALLETS);
    if (existing.length >= MAX_WALLETS) {
      throw new ConvexError(`You can monitor up to ${MAX_WALLETS} wallets.`);
    }

    const label = args.label?.trim();
    const walletId = await ctx.db.insert("wallets", {
      userId: user._id,
      address,
      chainFamily: "evm",
      label: label ? label : undefined,
      isPrimary: existing.length === 0,
      createdAt: Date.now(),
    });
    return walletId;
  },
});
