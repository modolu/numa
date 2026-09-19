"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  CategoryBadge,
  DemoBadge,
  SeverityBadge,
  StatusBadge,
} from "@/components/ui/Badge";
import { EmptyState, LoadingState } from "@/components/ui/States";
import { useNow } from "@/components/ui/useNow";
import { EventActions } from "@/components/inbox/EventActions";
import { chainLabel, EVENT_TYPE_LABEL } from "@/lib/formatting/events";
import { formatAbsolute, formatDeadline, formatRelative } from "@/lib/formatting/time";
import { shortenAddress } from "@/lib/validation/wallet";
import type { ReactNode } from "react";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 py-3 text-[14px]">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        {title}
      </h2>
      <div className="mt-2 text-[15px] leading-7 text-ink">{children}</div>
    </section>
  );
}

function isPresent(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function formatMetric(value: string | number): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  return value;
}

function formatUsd(value: string | number): string {
  if (typeof value !== "number") return String(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

const SOURCE_LABEL = {
  onchain: "Onchain data",
  official_web: "Official website",
  governance: "Governance",
} as const;

export function EventDetail({ eventId }: { eventId: string }) {
  const result = useQuery(api.events.getEvent, { eventId });
  const now = useNow();

  if (result === undefined) {
    return <LoadingState label="Loading event…" />;
  }
  if (result === null) {
    return (
      <EmptyState
        title="This item doesn't exist."
        description="It may have been removed, or the link is for a different account."
        action={
          <Link href="/inbox" className="text-sm font-medium text-accent hover:underline">
            Back to inbox
          </Link>
        }
      />
    );
  }

  const { event, wallet, protocol, task } = result;
  const m = event.metadata as Record<string, unknown>;
  const overdue = event.deadline !== undefined && now !== null && event.deadline < now;

  return (
    <article aria-labelledby="event-title">
      <Link
        href="/inbox"
        className="text-[13px] font-medium text-ink-muted hover:text-ink"
      >
        ← Inbox
      </Link>

      <header className="mt-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <SeverityBadge severity={event.severity} />
          <CategoryBadge category={event.category} />
          <StatusBadge status={event.status} />
          {event.isDemo && <DemoBadge />}
        </div>
        <h1
          id="event-title"
          className="mt-4 text-[26px] font-semibold leading-tight tracking-tight"
        >
          {event.title}
        </h1>
        {event.recommendedAction && (
          <p className="mt-2 text-[16px] text-ink-secondary">
            Next step: <span className="font-medium text-ink">{event.recommendedAction}</span>
            {event.deadline !== undefined && (
              <span className={overdue ? "text-sev-critical" : ""}>
                {" "}· due {now === null ? "…" : formatDeadline(event.deadline, now)}
              </span>
            )}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <EventActions event={event} layout="detail" />
          {event.actionUrl && (
            <a
              href={event.actionUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
            >
              Open official page ↗
            </a>
          )}
        </div>
      </header>

      <Section title="What happened">{event.summary}</Section>
      <Section title="Why it matters">{event.whyItMatters}</Section>
      {event.recommendedAction && (
        <Section title="Recommended next step">{event.recommendedAction}</Section>
      )}

      <section className="mt-10 rounded-(--radius-card) border border-line bg-surface px-5">
        <h2 className="sr-only">Details</h2>
        <dl className="divide-y divide-line">
          <Row label="Priority">
            {event.severity} · score {event.priorityScore.toFixed(2)}
          </Row>
          <Row label="Status">{event.status}</Row>
          <Row label="Wallet">
            {wallet ? (
              <span className="font-mono text-[13px]" title={wallet.address}>
                {wallet.label ? `${wallet.label} · ` : ""}
                {shortenAddress(wallet.address, 6)}
              </span>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Chain">{chainLabel(event.chainId)}</Row>
          <Row label="Protocol">{protocol ? protocol.name : "—"}</Row>
          <Row label="Event type">{EVENT_TYPE_LABEL[event.eventType]}</Row>
          <Row label="Deadline">
            {event.deadline !== undefined ? (
              <>
                {formatAbsolute(event.deadline)}
                {now !== null && (
                  <span className="text-ink-muted"> · {formatDeadline(event.deadline, now)}</span>
                )}
              </>
            ) : (
              "None"
            )}
          </Row>
          <Row label="Source">
            {SOURCE_LABEL[event.sourceType]}
            {event.sourceUrl && (
              <>
                {" · "}
                <a
                  href={event.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent hover:underline"
                >
                  {event.sourceUrl.replace(/^https?:\/\//, "")}
                </a>
              </>
            )}
            {event.sourceRef && (
              <span className="block truncate font-mono text-[12px] text-ink-muted">
                ref {event.sourceRef}
              </span>
            )}
          </Row>
          <Row label="Confidence">{Math.round(event.confidence * 100)}%</Row>
          <Row label="Detected">
            {formatAbsolute(event.detectedAt)}
            {now !== null && (
              <span className="text-ink-muted"> · {formatRelative(event.detectedAt, now)}</span>
            )}
          </Row>
          <Row label="Updated">
            {formatAbsolute(event.updatedAt)}
            {now !== null && (
              <span className="text-ink-muted"> · {formatRelative(event.updatedAt, now)}</span>
            )}
          </Row>
          {event.status === "snoozed" && event.snoozeUntil !== undefined && (
            <Row label="Snoozed until">{formatAbsolute(event.snoozeUntil)}</Row>
          )}
        </dl>
      </section>

      {(isPresent(m.previousValue) ||
        isPresent(m.currentValue) ||
        isPresent(m.exposureUsd) ||
        isPresent(m.relatedTransaction) ||
        isPresent(m.relatedContract) ||
        isPresent(m.officialActionUrl)) && (
        <section className="mt-6 rounded-(--radius-card) border border-line bg-surface px-5">
          <h2 className="pt-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Position details
          </h2>
          <dl className="divide-y divide-line">
            {isPresent(m.previousValue) && (
              <Row label="Previous value">{formatMetric(m.previousValue)}</Row>
            )}
            {isPresent(m.currentValue) && (
              <Row label="Current value">{formatMetric(m.currentValue)}</Row>
            )}
            {isPresent(m.exposureUsd) && (
              <Row label="Exposure">{formatUsd(m.exposureUsd)}</Row>
            )}
            {isPresent(m.relatedTransaction) && (
              <Row label="Transaction">
                <span className="font-mono text-[12px]">{String(m.relatedTransaction)}</span>
              </Row>
            )}
            {isPresent(m.relatedContract) && (
              <Row label="Contract">
                <span className="font-mono text-[12px]">{String(m.relatedContract)}</span>
              </Row>
            )}
            {isPresent(m.officialActionUrl) && (
              <Row label="Official action">
                <a
                  href={String(m.officialActionUrl)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent hover:underline"
                >
                  {String(m.officialActionUrl).replace(/^https?:\/\//, "")}
                </a>
              </Row>
            )}
          </dl>
        </section>
      )}

      {task && (
        <p className="mt-6 text-[13px] text-ink-muted">
          Task: <span className="text-ink">{task.title}</span> · {task.status}
        </p>
      )}
    </article>
  );
}
