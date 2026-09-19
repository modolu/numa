/**
 * TEMPORARY HACKATHON IDENTITY LAYER — NOT PRODUCTION AUTHENTICATION.
 *
 * Real authentication (Convex Auth / Clerk / WorkOS, NUMA_ARCHITECTURE.md §24)
 * is deferred to a later milestone. Until then one local Numa user owns all
 * wallet and event state on a deployment.
 *
 * Every query/mutation that touches user-owned data resolves its caller
 * through this module and only this module, so swapping in real auth is a
 * one-file change:
 *
 *   1. wire `convex/auth.config.ts` for the chosen provider;
 *   2. set `ALLOW_DEMO_IDENTITY` to false;
 *   3. nothing else changes — `ctx.auth.getUserIdentity()` is already
 *      consulted first and its `tokenIdentifier` becomes `identitySubject`.
 *
 * Ownership checks (convex/lib/access.ts) are structurally in place today:
 * every read is filtered by `userId` and every mutation verifies the target
 * document belongs to the resolved user.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Flip to `false` once a real auth provider is configured. */
export const ALLOW_DEMO_IDENTITY = true;

export const DEMO_IDENTITY_SUBJECT = "demo:local-numa-user";
const DEMO_DISPLAY_NAME = "Numa demo user";
const DEFAULT_TIMEZONE = "UTC";

/**
 * Resolve the stable identity key for the caller. Prefers a real identity
 * when one is present, otherwise falls back to the single demo identity.
 */
export async function resolveIdentitySubject(
  ctx: QueryCtx | MutationCtx,
): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    return identity.tokenIdentifier;
  }
  return ALLOW_DEMO_IDENTITY ? DEMO_IDENTITY_SUBJECT : null;
}

/** Look up the caller's user document without creating it (queries). */
export async function getCurrentUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const subject = await resolveIdentitySubject(ctx);
  if (subject === null) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_identity_subject", (q) => q.eq("identitySubject", subject))
    .unique();
}

/**
 * Resolve the caller's user document, creating it on first contact
 * (mutations only — queries cannot write).
 */
export async function requireUser(ctx: MutationCtx): Promise<Doc<"users">> {
  const subject = await resolveIdentitySubject(ctx);
  if (subject === null) {
    throw new Error("Not authenticated");
  }
  const existing = await ctx.db
    .query("users")
    .withIndex("by_identity_subject", (q) => q.eq("identitySubject", subject))
    .unique();
  if (existing) return existing;

  const identity = await ctx.auth.getUserIdentity();
  const userId = await ctx.db.insert("users", {
    identitySubject: subject,
    email: identity?.email ?? undefined,
    displayName: identity?.name ?? DEMO_DISPLAY_NAME,
    timezone: DEFAULT_TIMEZONE,
    createdAt: Date.now(),
  });
  const created = await ctx.db.get("users", userId);
  if (!created) throw new Error("Failed to create user");
  return created;
}
