/**
 * Protocol registry (NUMA_ARCHITECTURE.md §9, §35). Seeded idempotently by
 * slug; `officialHosts` is the allow-list that gates which URLs may become
 * monitored sources (§2.3, §27). No metadata that cannot be verified is
 * recorded (icons are intentionally absent).
 */
import { internalMutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export type KnownProtocol = {
  slug: string;
  name: string;
  category: string;
  officialDomain: string;
  supportedChains: number[];
  officialHosts: string[];
};

export const KNOWN_PROTOCOLS: readonly KnownProtocol[] = [
  {
    slug: "ens",
    name: "ENS",
    category: "naming",
    officialDomain: "ens.domains",
    supportedChains: [1],
    officialHosts: ["ens.domains"],
  },
  {
    slug: "aave",
    name: "Aave",
    category: "lending",
    officialDomain: "aave.com",
    supportedChains: [1, 42161],
    officialHosts: ["aave.com"],
  },
  {
    slug: "arbitrum-dao",
    name: "Arbitrum DAO",
    category: "governance",
    officialDomain: "arbitrum.foundation",
    supportedChains: [42161],
    officialHosts: ["arbitrum.foundation"],
  },
  {
    slug: "arbitrum-bridge",
    name: "Arbitrum Bridge",
    category: "bridge",
    officialDomain: "arbitrum.io",
    supportedChains: [1, 42161],
    officialHosts: ["arbitrum.io"],
  },
];

export function knownProtocol(slug: string): KnownProtocol | undefined {
  return KNOWN_PROTOCOLS.find((p) => p.slug === slug);
}

/** Hostnames a source for this protocol may live on. */
export function officialHostsFor(protocol: Pick<Doc<"protocols">, "officialDomain" | "officialHosts">): string[] {
  return Array.from(new Set([protocol.officialDomain, ...(protocol.officialHosts ?? [])].filter(Boolean)));
}

function fieldsFor(known: KnownProtocol) {
  return {
    name: known.name,
    category: known.category,
    officialDomain: known.officialDomain,
    supportedChains: known.supportedChains,
    officialHosts: known.officialHosts,
  };
}

/** Find or create the protocol row for a slug (used by ingestion). */
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
    ...(known
      ? fieldsFor(known)
      : { name: slug, category: "unknown", officialDomain: "", supportedChains: [] }),
  });
}

/**
 * Idempotent seed of the known catalog: inserts missing protocols and
 * refreshes the registry-owned fields of existing ones. Never duplicates.
 */
export async function seedProtocolsHelper(
  ctx: MutationCtx,
): Promise<{ inserted: number; updated: number; unchanged: number }> {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  for (const known of KNOWN_PROTOCOLS) {
    const existing = await ctx.db
      .query("protocols")
      .withIndex("by_slug", (q) => q.eq("slug", known.slug))
      .unique();
    const fields = fieldsFor(known);
    if (!existing) {
      await ctx.db.insert("protocols", { slug: known.slug, ...fields });
      inserted += 1;
    } else if (
      existing.name !== fields.name ||
      existing.category !== fields.category ||
      existing.officialDomain !== fields.officialDomain ||
      JSON.stringify(existing.supportedChains) !== JSON.stringify(fields.supportedChains) ||
      JSON.stringify(existing.officialHosts ?? []) !== JSON.stringify(fields.officialHosts)
    ) {
      await ctx.db.patch("protocols", existing._id, fields);
      updated += 1;
    } else {
      unchanged += 1;
    }
  }
  return { inserted, updated, unchanged };
}

export const seedProtocols = internalMutation({
  args: {},
  handler: async (ctx) => await seedProtocolsHelper(ctx),
});

export const listProtocols = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("protocols").take(50);
    return rows
      .map((p) => ({ _id: p._id, slug: p.slug, name: p.name, category: p.category, officialDomain: p.officialDomain }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});
