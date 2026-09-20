"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LoadingState } from "@/components/ui/States";
import { useNow } from "@/components/ui/useNow";
import { formatDeadline, formatRelative } from "@/lib/formatting/time";

const TYPE_LABEL: Record<string, string> = {
  daily_brief: "Daily brief",
  urgent_event: "Urgent alert",
  deadline_reminder: "Deadline reminder",
  test_brief: "Test brief",
};

const STATUS_CLASS: Record<string, string> = {
  sent: "text-success",
  delivered: "text-success",
  failed: "text-sev-high",
  bounced: "text-sev-high",
  rejected: "text-sev-high",
  complained: "text-sev-high",
};

export function NotificationHistory() {
  const rows = useQuery(api.notifications.listNotifications);
  const now = useNow();
  return (
    <section className="mt-6 rounded-(--radius-card) border border-line bg-surface p-5">
      <h2 className="text-[15px] font-medium">Recent notifications</h2>
      <p className="mt-1 text-[13px] leading-5 text-ink-secondary">Every email attempt Numa makes is recorded here.</p>
      {rows === undefined ? (
        <div className="mt-4"><LoadingState label="Loading history…" /></div>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-[13px] text-ink-muted">Nothing sent yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((n) => (
            <li key={n._id} className="flex items-start justify-between gap-4 py-3 text-[13px]">
              <div className="min-w-0">
                <p className="font-medium">
                  {TYPE_LABEL[n.type] ?? n.type}
                  {n.reminderOffset ? ` (${n.reminderOffset} before)` : ""}
                  {n.isTest ? <span className="ml-2 text-[11px] uppercase tracking-[0.08em] text-ink-muted">test</span> : null}
                </p>
                {n.event && (
                  <Link href={`/event/${n.event._id}`} className="block truncate text-ink-secondary hover:underline">{n.event.title}</Link>
                )}
                {n.brief && <p className="truncate text-ink-secondary">{n.brief.headline} · {n.brief.period}</p>}
                {n.failureReason && <p className="truncate text-[12px] text-sev-high" title={n.failureReason}>{n.failureReason}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className={STATUS_CLASS[n.status] ?? "text-ink-muted"}>{n.status}</p>
                <p className="text-[12px] text-ink-muted">
                  {n.sentAt !== undefined && now !== null
                    ? `sent ${formatRelative(n.sentAt, now)}`
                    : n.scheduledFor !== undefined && n.status === "queued" && now !== null
                      ? `fires ${formatDeadline(n.scheduledFor, now)}`
                      : now !== null ? `created ${formatRelative(n.createdAt, now)}` : "…"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
