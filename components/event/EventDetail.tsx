"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  AiBadge,
  CategoryBadge,
  DemoBadge,
  LiveBadge,
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

const RELATIONSHIP_LABEL: Record<string, string> = {
  registrant: "This wallet holds the registration",
  wrapped_owner: "This wallet holds the registration (wrapped)",
  primary_name: "Primary name of this wallet; registration held elsewhere",
};

type InterpretationSummary = {
  status: "pending" | "running" | "ok" | "rejected" | "failed";
  attempts: number;
  errorKind?: string;
  result: { relevant: boolean } | null;
} | null;

function InterpretationStatus({ interpretation }: { interpretation: InterpretationSummary }) {
  if (!interpretation) {
    return <span className="text-ink-secondary">Not yet interpreted — change detected from official source content only.</span>;
  }
  switch (interpretation.status) {
    case "pending":
    case "running":
      return <span className="text-ink-secondary">Interpretation pending — showing the detected change meanwhile.</span>;
    case "failed":
      return (
        <span className="text-ink-secondary">
          Interpretation unavailable ({interpretation.errorKind ?? "error"}) — showing the detected change. {interpretation.errorKind === "transient" ? "Numa will retry." : ""}
        </span>
      );
    case "rejected":
      return <span className="text-ink-secondary">Interpretation withheld — the model&apos;s answer did not pass Numa&apos;s grounding checks. Showing the detected change.</span>;
    case "ok":
      return interpretation.result?.relevant ? (
        <span className="text-ink-secondary">Interpreted by Numa — see below.</span>
      ) : (
        <span className="text-ink-secondary">Interpreted by Numa: no direct impact on your known exposure.</span>
      );
  }
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

  const { event, wallet, protocol, task, source, interpretation } = result;
  const interpreted = interpretation?.status === "ok" && interpretation.result?.relevant === true;
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
          {interpreted && <AiBadge />}
          {event.isDemo ? <DemoBadge /> : <LiveBadge />}
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
        isPresent(m.relationship) ||
        isPresent(m.gracePeriodEndsAt) ||
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
            {isPresent(m.relationship) && (
              <Row label="Relationship">{RELATIONSHIP_LABEL[String(m.relationship)] ?? String(m.relationship)}</Row>
            )}
            {isPresent(m.registrant) && (
              <Row label="Held by">
                <span className="font-mono text-[12px]">{String(m.registrant)}</span>
              </Row>
            )}
            {typeof m.gracePeriodEndsAt === "number" && (
              <Row label="Grace period ends">{formatAbsolute(m.gracePeriodEndsAt)}</Row>
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

      {source && (
        <section className="mt-6 rounded-(--radius-card) border border-line bg-surface px-5">
          <h2 className="pt-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Source monitoring
          </h2>
          <dl className="divide-y divide-line">
            <Row label="Monitored page">
              <a href={source.url} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                {source.url.replace(/^https?:\/\//, "")}
              </a>
              <span className="text-ink-muted"> · {source.sourceType}</span>
            </Row>
            <Row label="Last crawl">
              {source.lastCrawledAt !== undefined ? (
                <>
                  {formatAbsolute(source.lastCrawledAt)}
                  {now !== null && <span className="text-ink-muted"> · {formatRelative(source.lastCrawledAt, now)}</span>}
                </>
              ) : "—"}
              {source.lastCrawlStatus === "failed" && (
                <span className="block text-[12px] text-sev-high">Provider currently unavailable — showing last known state</span>
              )}
            </Row>
            {typeof m.currentHash === "string" && (
              <Row label="Content version">
                <span className="font-mono text-[12px]">{String(m.currentHash).slice(0, 12)}</span>
                {typeof m.previousHash === "string" && (
                  <span className="font-mono text-[12px] text-ink-muted"> (was {String(m.previousHash).slice(0, 12)})</span>
                )}
              </Row>
            )}
            {typeof m.excerpt === "string" && m.excerpt.length > 0 && (
              <Row label="Page excerpt">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface-muted p-3 font-mono text-[12px] leading-5 text-ink-secondary">
                  {String(m.excerpt)}
                </pre>
              </Row>
            )}
            <Row label="Interpretation">
              <InterpretationStatus interpretation={interpretation} />
            </Row>
          </dl>
        </section>
      )}

      {interpretation?.status === "ok" && interpretation.result && (
        <section className="mt-6 rounded-(--radius-card) border border-line bg-surface px-5">
          <h2 className="pt-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            AI interpretation
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-ink-secondary">
            Generated by Numa&apos;s interpretation step from the official source text and your known exposure, then checked by Numa&apos;s validation rules. Not human-verified.
          </p>
          <dl className="divide-y divide-line">
            <Row label="Verdict">
              {interpretation.result.relevant ? "Relevant to your exposure" : "No direct impact on your known exposure"}
              <span className="text-ink-muted"> · confidence {Math.round(interpretation.result.confidence * 100)}%</span>
            </Row>
            <Row label="Reason">{interpretation.result.relevanceReason}</Row>
            <Row label="Exposure basis">
              {interpretation.result.exposureOrigin === "live" ? (
                <><LiveBadge /> <span className="ml-2">Live wallet evidence</span></>
              ) : (
                <><DemoBadge /> <span className="ml-2">Demo-derived exposure — fixture data, not real wallet analysis</span></>
              )}
            </Row>
            {interpretation.result.evidence.length > 0 && (
              <Row label="Source quotes">
                <ul className="space-y-1">
                  {interpretation.result.evidence.map((q, i) => (
                    <li key={i} className="border-l-2 border-line-strong pl-3 text-[13px] text-ink-secondary">“{q}”</li>
                  ))}
                </ul>
              </Row>
            )}
            {interpretation.result.deadlineEvidence && (
              <Row label="Deadline basis">
                <span className="text-[13px] text-ink-secondary">“{interpretation.result.deadlineEvidence}”</span>
              </Row>
            )}
            <Row label="Severity">
              {interpretation.result.severity}
              <span className="text-ink-muted"> · model claimed {interpretation.result.claimedSeverity}</span>
              {interpretation.result.severityCapped && (
                <span className="block text-[12px] text-ink-muted">Capped at low: no deterministic corroboration (explicit source deadline or live wallet data) was available.</span>
              )}
            </Row>
            {interpretation.result.unsupportedClaims.length > 0 && (
              <Row label="Not included">
                <span className="text-[13px] text-ink-secondary">
                  {interpretation.result.unsupportedClaims.length} claim{interpretation.result.unsupportedClaims.length === 1 ? "" : "s"} the model could not ground were left out.
                </span>
              </Row>
            )}
            <Row label="Interpreted">
              {interpretation.interpretedAt !== undefined ? formatAbsolute(interpretation.interpretedAt) : "—"}
              <span className="text-ink-muted"> · {interpretation.model ?? "model"} · v{interpretation.version}</span>
            </Row>
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
