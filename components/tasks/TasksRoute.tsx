"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { TaskWithEvent } from "@/convex/tasks";
import { SeverityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { EmptyState, InlineError, LoadingState } from "@/components/ui/States";
import { errorMessage } from "@/components/ui/errors";
import { useNow } from "@/components/ui/useNow";
import { formatDeadline } from "@/lib/formatting/time";

function TaskRow({ task, now }: { task: TaskWithEvent; now: number | null }) {
  const complete = useMutation(api.tasks.completeTask);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = task.status === "completed";

  async function onComplete() {
    setBusy(true);
    setError(null);
    try {
      await complete({ taskId: task._id });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {task.event && <SeverityBadge severity={task.event.severity} />}
          {task.event?.isDemo && (
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-muted">demo</span>
          )}
        </div>
        <p className={`mt-1.5 text-[15px] font-medium ${done ? "text-ink-muted line-through" : ""}`}>
          {task.title}
        </p>
        {task.event && (
          <Link
            href={`/event/${task.event._id}`}
            className="mt-0.5 block truncate text-[13px] text-ink-secondary hover:text-ink hover:underline"
          >
            {task.event.title}
          </Link>
        )}
        {task.dueAt !== undefined && now !== null && !done && (
          <p className="mt-1 text-[12px] text-ink-muted">Due {formatDeadline(task.dueAt, now)}</p>
        )}
        <InlineError message={error} />
      </div>
      {!done && task.status !== "cancelled" && (
        <Button size="sm" disabled={busy} onClick={onComplete}>
          {busy ? "…" : "Complete"}
        </Button>
      )}
    </li>
  );
}

function TasksScreen() {
  const tasks = useQuery(api.tasks.getTasks);
  const now = useNow();

  if (tasks === undefined) return <LoadingState label="Loading tasks…" />;

  const { open, snoozed, completed } = tasks;
  const total = open.length + snoozed.length + completed.length;

  return (
    <>
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Tasks</h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          Explicit to-dos created from actionable inbox items.
        </p>
      </header>
      {total === 0 ? (
        <EmptyState
          title="No tasks yet."
          description="Actionable inbox items create tasks automatically."
        />
      ) : (
        <>
          {open.length > 0 && (
            <ul className="divide-y divide-line rounded-(--radius-card) border border-line bg-surface">
              {open.map((task) => (
                <TaskRow key={task._id} task={task} now={now} />
              ))}
            </ul>
          )}
          {snoozed.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                Snoozed · {snoozed.length}
              </h2>
              <ul className="divide-y divide-line rounded-(--radius-card) border border-line bg-surface">
                {snoozed.map((task) => (
                  <TaskRow key={task._id} task={task} now={now} />
                ))}
              </ul>
            </section>
          )}
          {completed.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                Completed · {completed.length}
              </h2>
              <ul className="divide-y divide-line rounded-(--radius-card) border border-line bg-surface">
                {completed.map((task) => (
                  <TaskRow key={task._id} task={task} now={now} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

export function TasksRoute() {
  return (
    <ErrorBoundary label="Tasks">
      <TasksScreen />
    </ErrorBoundary>
  );
}
