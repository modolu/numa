"use client";

import { eventHref } from "@/components/event/EventRoute";

import Link from "next/link";
import type { Doc } from "@/convex/_generated/dataModel";
import { AiBadge, CategoryBadge, DemoBadge, LiveBadge, SeverityBadge } from "@/components/ui/Badge";
import { formatDeadline } from "@/lib/formatting/time";
import { EventActions } from "./EventActions";

/**
 * Inbox card anatomy (NUMA_ARCHITECTURE.md §38):
 *
 *   [SEVERITY] [CATEGORY]            [Demo data]
 *   Title
 *   Short explanation.
 *   Recommended action · Due: in 7h
 *   [Mark done] [Mark read] [Snooze] [Dismiss]
 */
export function InboxCard({
  event,
  now,
}: {
  event: Doc<"events">;
  now: number | null;
}) {
  const unread = event.status === "unread";
  const overdue = event.deadline !== undefined && now !== null && event.deadline < now;

  return (
    <article
      aria-labelledby={`event-${event._id}-title`}
      className={`group rounded-(--radius-card) border bg-surface p-5 transition-colors ${
        unread ? "border-line-strong" : "border-line"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <SeverityBadge severity={event.severity} />
          <CategoryBadge category={event.category} />
        </div>
        <div className="flex items-center gap-2">
          {event.metadata.interpreted === true && event.metadata.interpretation && (event.metadata.interpretation as { relevant?: boolean }).relevant !== false && <AiBadge />}
          {event.isDemo ? <DemoBadge /> : <LiveBadge />}
          {unread && (
            <span
              className="h-2 w-2 rounded-full bg-accent"
              aria-label="Unread"
              title="Unread"
            />
          )}
        </div>
      </div>

      <h3
        id={`event-${event._id}-title`}
        className={`mt-3 text-[17px] leading-6 tracking-tight ${
          unread ? "font-semibold" : "font-medium"
        }`}
      >
        <Link
          href={eventHref(event._id)}
          className="rounded-sm hover:underline hover:underline-offset-4"
        >
          {event.title}
        </Link>
      </h3>
      <p className="mt-1.5 max-w-3xl text-[14px] leading-6 text-ink-secondary">
        {event.summary}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        {event.recommendedAction && (
          <span className="font-medium text-ink">{event.recommendedAction}</span>
        )}
        {event.sourceType === "official_web" && (
          <span className="text-ink-muted">Official web</span>
        )}
        {event.deadline !== undefined && (
          <span
            className={overdue ? "font-medium text-sev-critical" : "text-ink-muted"}
          >
            Due: {now === null ? "…" : formatDeadline(event.deadline, now)}
          </span>
        )}
        {event.status === "snoozed" && event.snoozeUntil !== undefined && (
          <span className="text-ink-muted">
            Snoozed until {new Date(event.snoozeUntil).toLocaleString()}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <EventActions event={event} layout="card" />
        <Link
          href={eventHref(event._id)}
          className="ml-auto whitespace-nowrap text-[13px] font-medium text-accent hover:underline hover:underline-offset-4"
        >
          Open →
        </Link>
      </div>
    </article>
  );
}
