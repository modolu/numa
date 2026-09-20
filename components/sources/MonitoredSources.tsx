"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/Button";
import { InlineError, LoadingState } from "@/components/ui/States";
import { errorMessage } from "@/components/ui/errors";
import { useNow } from "@/components/ui/useNow";
import { formatRelative } from "@/lib/formatting/time";

const COOLDOWN_MS = 20_000;

const POLICY_LABEL: Record<string, string> = {
  governance: "every 30 min",
  status: "every 10 min",
  updates: "every 3 h",
  docs: "every 6 h",
  static: "daily",
};

type Feedback = { tone: "neutral" | "success" | "error"; text: string } | null;

/**
 * Understated admin panel: which official pages Numa watches, how healthy
 * each crawl is, and a single "Refresh monitored sources" control. Only
 * registry sources are ever crawled — nothing here accepts a URL.
 */
export function MonitoredSources() {
  const sources = useQuery(api.sources.list);
  const refresh = useAction(api.ingestion.firecrawl.refreshSources);
  const now = useNow();
  const [running, setRunning] = useState(false);
  const [coolingDown, setCoolingDown] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  async function onRefresh() {
    if (running || coolingDown) return;
    setRunning(true);
    setFeedback({ tone: "neutral", text: "Checking sources…" });
    try {
      const r = await refresh({});
      if (r.checked === 0 && r.failed > 0) {
        setFeedback({ tone: "error", text: "Provider unavailable — last known content kept." });
      } else if (r.checked === 0 && r.skipped > 0) {
        setFeedback({ tone: "neutral", text: "Checked a moment ago — try again shortly." });
      } else {
        const parts: string[] = [];
        if (r.changed > 0) parts.push(`${r.changed} source${r.changed === 1 ? "" : "s"} updated`);
        if (r.baseline > 0) parts.push(`${r.baseline} baseline${r.baseline === 1 ? "" : "s"} recorded`);
        if (parts.length === 0) parts.push("No changes");
        if (r.failed > 0) parts.push(`${r.failed} unavailable`);
        setFeedback({ tone: r.failed > 0 ? "error" : "success", text: parts.join(" · ") });
      }
    } catch (err) {
      setFeedback({ tone: "error", text: errorMessage(err) });
    } finally {
      setRunning(false);
      setCoolingDown(true);
      timer.current = window.setTimeout(() => setCoolingDown(false), COOLDOWN_MS);
    }
  }

  const toneClass =
    feedback?.tone === "error" ? "text-sev-critical" : feedback?.tone === "success" ? "text-success" : "text-ink-muted";

  return (
    <section className="mt-6 rounded-(--radius-card) border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-medium">Monitored official sources</h2>
          <p className="mt-1 text-[13px] leading-5 text-ink-secondary">
            Official pages Numa checks for changes. A change only reaches your inbox when
            your wallet has exposure to that protocol.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Button size="sm" disabled={running || coolingDown} aria-busy={running} onClick={onRefresh}>
            {running ? "Checking…" : "Refresh monitored sources"}
          </Button>
          {feedback && (
            <p role="status" aria-live="polite" className={`text-[12px] ${toneClass}`}>{feedback.text}</p>
          )}
        </div>
      </div>

      {sources === undefined ? (
        <div className="mt-4"><LoadingState label="Loading sources…" /></div>
      ) : sources.length === 0 ? (
        <p className="mt-4 text-[13px] text-ink-muted">
          No sources registered yet — refresh once to seed the official registry.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {sources.map((s) => {
            const status =
              s.lastCrawlStatus === "failed"
                ? { text: "Provider unavailable", cls: "text-sev-high" }
                : s.lastCrawlStatus === "running"
                  ? { text: "Checking…", cls: "text-ink-muted" }
                  : s.lastCrawledAt !== undefined
                    ? { text: `Checked ${now ? formatRelative(s.lastCrawledAt, now) : "…"}`, cls: "text-ink-muted" }
                    : { text: "Not checked yet", cls: "text-ink-muted" };
            return (
              <li key={s._id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">
                    {s.protocol?.name ?? "Unknown"}{" "}
                    <span className="font-normal text-ink-muted">· {s.sourceType} · {POLICY_LABEL[s.crawlPolicy] ?? s.crawlPolicy}</span>
                  </p>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-0.5 block truncate text-[13px] text-accent hover:underline"
                  >
                    {s.url.replace(/^https?:\/\//, "")}
                  </a>
                  {s.lastCrawlStatus === "failed" && s.lastCrawlError && (
                    <p className="mt-0.5 truncate text-[12px] text-sev-high" title={s.lastCrawlError}>
                      {s.lastCrawlError}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right text-[12px]">
                  <p className={status.cls}>{status.text}</p>
                  {s.lastChangedAt !== undefined && now !== null && (
                    <p className="text-ink-muted">Changed {formatRelative(s.lastChangedAt, now)}</p>
                  )}
                  {s.lastCrawlStatus === "failed" && s.lastCrawledAt !== undefined && now !== null && (
                    <p className="text-ink-muted">Last success {formatRelative(s.lastCrawledAt, now)}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <InlineError message={null} />
    </section>
  );
}
