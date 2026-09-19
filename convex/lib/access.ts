/**
 * Ownership checks. Every function that reads or mutates a user-owned
 * document goes through one of these helpers so the rule lives in one place
 * (NUMA_ARCHITECTURE.md §24, §26).
 *
 * A document that exists but belongs to another user is reported exactly
 * like a missing one, so callers cannot probe for other users' data.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export async function getOwnedWallet(
  ctx: Ctx,
  userId: Id<"users">,
  walletId: Id<"wallets">,
): Promise<Doc<"wallets"> | null> {
  const wallet = await ctx.db.get("wallets", walletId);
  return wallet && wallet.userId === userId ? wallet : null;
}

export async function requireOwnedWallet(
  ctx: Ctx,
  userId: Id<"users">,
  walletId: Id<"wallets">,
): Promise<Doc<"wallets">> {
  const wallet = await getOwnedWallet(ctx, userId, walletId);
  if (!wallet) throw new Error("Wallet not found");
  return wallet;
}

export async function getOwnedEvent(
  ctx: Ctx,
  userId: Id<"users">,
  eventId: Id<"events">,
): Promise<Doc<"events"> | null> {
  const event = await ctx.db.get("events", eventId);
  return event && event.userId === userId ? event : null;
}

export async function requireOwnedEvent(
  ctx: Ctx,
  userId: Id<"users">,
  eventId: Id<"events">,
): Promise<Doc<"events">> {
  const event = await getOwnedEvent(ctx, userId, eventId);
  if (!event) throw new Error("Event not found");
  return event;
}

export async function getOwnedTask(
  ctx: Ctx,
  userId: Id<"users">,
  taskId: Id<"tasks">,
): Promise<Doc<"tasks"> | null> {
  const task = await ctx.db.get("tasks", taskId);
  return task && task.userId === userId ? task : null;
}

export async function requireOwnedTask(
  ctx: Ctx,
  userId: Id<"users">,
  taskId: Id<"tasks">,
): Promise<Doc<"tasks">> {
  const task = await getOwnedTask(ctx, userId, taskId);
  if (!task) throw new Error("Task not found");
  return task;
}
