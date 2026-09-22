"use client";

import { eventHref } from "@/components/event/EventRoute";

import Link from "next/link";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { DemoBadge, AiBadge, SeverityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { EmptyState, InlineError, LoadingState } from "@/components/ui/States";
import { errorMessage } from "@/components/ui/errors";
import { useNow } from "@/components/ui/useNow";
import { formatAbsolute, formatDeadline, formatRelative } from "@/lib/formatting/time";

function DeliveryStatus({ notification }: { notification: { status: string; sentAt?: number; failureKind?: string; failureReason?: string; isTest: boolean } | null }) {
  const now = useNow();
  if (!notification) return <span className="text-ink-muted">Not sent</span>;
  switch (notification.status) {
    case "sent":
    case "delivered":
      return (
        <span className="text-success">
          {notification.status === "delivered" ? "Delivered" : "Sent"}
          {notification.sentAt !== undefined && now !== null ? ` · ${formatRelative(notification.sentAt, now)}` : ""}
          {notification.isTest ? " · test" : ""}
        </span>
      );
    case "queued":
    case "sending":
      return <span className="text-ink-muted">Sending…</span>;
    case "failed":
      return (
        <span className="text-sev-high">
          Delivery failed{notification.failureKind === "transient" ? " — Numa will retry" : ""}
          {notification.failureReason ? ` · ${notification.failureReason}` : ""}
        </span>
      );
    case "cancelled":
      return <span className="text-ink-muted">Cancelled{notification.failureReason ? ` · ${notification.failureReason}` : ""}</span>;
    default:
      return <span className="text-ink-muted">{notification.status}</span>;
  }
}

function BriefScreen() {
  const now = useNow();
  const today = useQuery(api.briefs.getTodayBrief, now === null ? "skip" : { now });
  const prefs = useQuery(api.notifications.getPreferences);
  const generate = useMutation(api.briefs.generateBrief);
  const sendTest = useAction(api.ingestion.mail.sendTestBrief);
  const [busy, setBusy] = useState<"generate" | "send" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "generate" | "send") {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      if (kind === "generate") {
        const r = await generate({ force: today?.brief !== null });
        setMessage(`${r.created ? "Brief generated" : "Brief already current"} · ${r.itemCount} item${r.itemCount === 1 ? "" : "s"}.`);
      } else {
        const r = await sendTest({});
        setMessage(
          r.status === "sent"
            ? "Test brief sent to your configured address."
            : r.status === "failed"
              ? `Send failed: ${r.error}`
              : `Not sent: ${r.reason}`,
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const canSend = prefs?.recipient.configured && prefs.senderConfigured;

  return (
    <>
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Your Numa brief</h1>
        <p className="mt-2 max-w-3xl text-[15px] text-ink-secondary">
          The few items that matter today, built from your inbox — never from raw wallet data. Delivered by email at your digest time.
        </p>
      </header>

      {today === undefined || now === null ? (
        <LoadingState label="Loading today's brief…" />
      ) : today === null ? (
        <EmptyState title="Add a wallet first." description="Briefs are built from your inbox once a wallet is monitored." />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="text-[13px] text-ink-muted">
              <p>{today.period} · {today.brief ? `generated ${formatRelative(today.brief.generatedAt, now)}` : "not generated yet"}</p>
              <p>Email: <DeliveryStatus notification={today.notification} /></p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <Button size="sm" disabled={busy !== null} onClick={() => run("generate")}>
                  {busy === "generate" ? "Generating…" : today.brief ? "Regenerate today's brief" : "Generate today's brief"}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy !== null || !canSend}
                  title={!canSend ? "Configure a recipient and the AgentMail sender in Settings first" : undefined}
                  onClick={() => run("send")}
                >
                  {busy === "send" ? "Sending…" : "Send test brief"}
                </Button>
              </div>
              {message && <p role="status" className="text-[12px] text-ink-muted">{message}</p>}
              <InlineError message={error} />
              {!canSend && prefs && (
                <p className="text-[12px] text-ink-muted">
                  {!prefs.recipient.configured ? "Email delivery is not configured: no recipient address." : "Email delivery is not configured: AgentMail sender missing."}
                </p>
              )}
            </div>
          </div>

          {!today.brief ? (
            <EmptyState
              title="No brief for today yet."
              description="Generate one now, or wait for your digest time. Briefs contain at most five items, ranked by Numa's priority engine."
            />
          ) : (
            <section className="rounded-(--radius-card) border border-line bg-surface p-6">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Your Numa brief</p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-tight">{today.brief.headline}</h2>
              <p className="mt-1 max-w-3xl text-[14px] text-ink-secondary">{today.brief.summary}</p>
              {today.brief.items.length > 0 && (
                <ol className="mt-5 divide-y divide-line">
                  {today.brief.items.map((item, i) => (
                    <li key={item.eventId} className="py-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SeverityBadge severity={item.severity} />
                        {item.isDemo && <DemoBadge />}
                        {item.interpreted && <AiBadge />}
                      </div>
                      <p className="mt-2 text-[16px] font-medium">
                        {i + 1}. <Link href={eventHref(item.eventId)} className="hover:underline">{item.title}</Link>
                      </p>
                      <p className="mt-1 max-w-3xl text-[14px] leading-6 text-ink-secondary">{item.whyItMatters}</p>
                      <p className="mt-1 text-[13px]">
                        {item.recommendedAction && <span className="font-medium">Next: {item.recommendedAction}</span>}
                        {item.deadline !== undefined && <span className="text-ink-muted"> · Due {formatDeadline(item.deadline, now)}</span>}
                        {item.actionUrl && (
                          <>
                            {" · "}
                            <a href={item.actionUrl} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">Official page ↗</a>
                          </>
                        )}
                      </p>
                      <p className="mt-1 text-[12px] text-ink-muted">Source: {item.sourceLabel}</p>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-5 text-[13px] text-ink-muted">
                <strong className="text-ink-secondary">Everything else:</strong>{" "}
                {today.brief.remaining > 0 ? `${today.brief.remaining} lower-priority item${today.brief.remaining === 1 ? "" : "s"} stay in the app.` : "No action needed."}
              </p>
              <p className="mt-3 text-[12px] text-ink-muted">Generated {formatAbsolute(today.brief.generatedAt)}</p>
            </section>
          )}
        </>
      )}
    </>
  );
}

export function BriefRoute() {
  return (
    <ErrorBoundary label="Your brief">
      <BriefScreen />
    </ErrorBoundary>
  );
}
