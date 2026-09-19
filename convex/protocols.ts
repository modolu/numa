/**
 * Protocol registry (NUMA_ARCHITECTURE.md §9, §35). Rows are created lazily
 * by ingestion from this known list; later milestones attach
 * `protocolSources` for Firecrawl monitoring.
 */
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export type KnownProtocol = {
  slug: string;
  name: string;
  category: string;
  officialDomain: string;
  supportedChains: number[];
};

export const KNOWN_PROTOCOLS: readonly KnownProtocol[] = [
  {
    slug: "ens",
    name: "ENS",
    category: "naming",
    officialDomain: "ens.domains",
    supportedChains: [1],
  },
  {
    slug: "aave",
    name: "Aave",
    category: "lending",
    officialDomain: "aave.com",
    supportedChains: [1, 42161],
  },
  {
    slug: "arbitrum-dao",
    name: "Arbitrum DAO",
    category: "governance",
    officialDomain: "arbitrum.foundation",
    supportedChains: [42161],
  },
  {
    slug: "arbitrum-bridge",
    name: "Arbitrum Bridge",
    category: "bridge",
    officialDomain: "arbitrum.io",
    supportedChains: [1, 42161],
  },
];

export function knownProtocol(slug: string): KnownProtocol | undefined {
  return KNOWN_PROTOCOLS.find((p) => p.slug === slug);
}

/** Find or create the protocol row for a slug. */
export async function ensureProtocol(
  ctx: MutationCtx,
  slug: string,
): Promise<Id<"protocols">> {
  const existing = await ctx.db
    .query("protocols")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (existing) return existing._id;

  const known = knownProtocol(slug);
  return await ctx.db.insert("protocols", {
    slug,
    name: known?.name ?? slug,
    category: known?.category ?? "unknown",
    officialDomain: known?.officialDomain ?? "",
    supportedChains: known?.supportedChains ?? [],
  });
}
