/**
 * Raw observations are written by the ingestion pipeline
 * (convex/ingestion/pipeline.ts). This module exposes them for audit and
 * debugging only; nothing here is public.
 */
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const listForWallet = internalQuery({
  args: { walletId: v.id("wallets"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rawEvents")
      .withIndex("by_wallet", (q) => q.eq("walletId", args.walletId))
      .order("desc")
      .take(Math.min(args.limit ?? 50, 200));
  },
});
