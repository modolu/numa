/**
 * Tasks are the explicit to-dos some inbox items create (NUMA_ARCHITECTURE.md
 * §4.2). One task per actionable event, kept in step with the event's
 * lifecycle by `syncTaskForEvent` (ingestion) and the event mutations.
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getCurrentUser, requireUser } from "./lib/identity";
import { requireOwnedTask } from "./lib/access";
import { canTransition } from "./lib/lifecycle";
import { sortInbox } from "./lib/inboxOrder";

const TASK_PAGE = 100;

/** Create or refresh the task for an actionable event after ingestion. */
export async function syncTaskForEvent(
  ctx: MutationCtx,
  eventId: Id<"events">,
  now: number,
): Promise<void> {
  const event = await ctx.db.get("events", eventId);
  if (!event || !event.requiresAction) return;

  const existing = await ctx.db
    .query("tasks")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .unique();

  const title = event.recommendedAction ?? event.title;

  if (!existing) {
    if (event.status === "completed" || event.status === "dismissed") return;
    await ctx.db.insert("tasks", {
      userId: event.userId,
      eventId,
      title,
      status: event.status === "snoozed" ? "snoozed" : "open",
      recommendedActionUrl: event.actionUrl,
      dueAt: event.deadline,
      snoozeUntil: event.snoozeUntil,
      createdAt: now,
    });
    return;
  }

  if (existing.status === "completed" || existing.status === "cancelled") return;
  if (
    existing.title !== title ||
    existing.dueAt !== event.deadline ||
    existing.recommendedActionUrl !== event.actionUrl
  ) {
    await ctx.db.patch("tasks", existing._id, {
      title,
      dueAt: event.deadline,
      recommendedActionUrl: event.actionUrl,
    });
  }
}

export type TaskWithEvent = Doc<"tasks"> & {
  event: Pick<
    Doc<"events">,
    "_id" | "title" | "severity" | "category" | "priorityScore" | "detectedAt" | "isDemo" | "deadline"
  > | null;
};

export const getTasks = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { open: [], snoozed: [], completed: [] };

    const load = async (status: Doc<"tasks">["status"], limit: number) => {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_user_and_status", (q) =>
          q.eq("userId", user._id).eq("status", status),
        )
        .take(limit);
      const withEvents: TaskWithEvent[] = await Promise.all(
        tasks.map(async (task) => {
          const event = await ctx.db.get("events", task.eventId);
          return {
            ...task,
            event: event
              ? {
                  _id: event._id,
                  title: event.title,
                  severity: event.severity,
                  category: event.category,
                  priorityScore: event.priorityScore,
                  detectedAt: event.detectedAt,
                  isDemo: event.isDemo,
                  deadline: event.deadline,
                }
              : null,
          };
        }),
      );
      return withEvents;
    };

    const [open, snoozed, completed] = await Promise.all([
      load("open", TASK_PAGE),
      load("snoozed", TASK_PAGE),
      load("completed", 50),
    ]);

    const byEventPriority = (tasks: TaskWithEvent[]) => {
      const sortable = tasks.filter((t) => t.event !== null);
      const rest = tasks.filter((t) => t.event === null);
      const sorted = sortInbox(
        sortable.map((t) => ({
          task: t,
          severity: t.event!.severity,
          deadline: t.event!.deadline,
          priorityScore: t.event!.priorityScore,
          detectedAt: t.event!.detectedAt,
        })),
      ).map((entry) => entry.task);
      return [...sorted, ...rest];
    };

    return {
      open: byEventPriority(open),
      snoozed: byEventPriority(snoozed),
      completed: completed.sort(
        (a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0),
      ),
    };
  },
});

export const completeTask = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const task = await requireOwnedTask(ctx, user._id, args.taskId);
    if (task.status === "completed") return null; // idempotent
    if (task.status === "cancelled") {
      throw new ConvexError("This task was cancelled when its item was dismissed.");
    }
    const now = Date.now();
    await ctx.db.patch("tasks", task._id, {
      status: "completed",
      completedAt: now,
      snoozeUntil: undefined,
    });

    const event = await ctx.db.get("events", task.eventId);
    if (
      event &&
      event.userId === user._id &&
      canTransition(event.status, "completed")
    ) {
      await ctx.db.patch("events", event._id, {
        status: "completed",
        completedAt: now,
        snoozeUntil: undefined,
        updatedAt: now,
      });
    }
    return null;
  },
});
