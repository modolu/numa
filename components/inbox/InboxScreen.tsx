"use client";

import Link from "next/link";

import { eventHref } from "@/components/event/EventRoute";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/Button";
import { EmptyState, InlineError, LoadingState } from "@/components/ui/States";
import { errorMessage } from "@/components/ui/errors";
import { useNow } from "@/components/ui/useNow";
import { attentionHeadline } from "@/lib/formatting/events";
import { greetingForHour } from "@/lib/formatting/time";
import { shortenAddress } from "@/lib/validation/wallet";
import { InboxCard } from "./InboxCard";
import { RefreshWalletButton } from "@/components/wallet/RefreshWalletButton";
import { ScanHealth } from "@/components/wallet/ScanHealth";

function SeedDemoButton({
  wallet,
  variant = "primary",
  onResult,
}: {
  wallet: Doc<"wallets">;
  variant?: "primary" | "secondary";
  onResult?: (message: string) => void;
}) {
  const seed = useMutation(api.ingestion.fixtures.seedDemoEvents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const result = await seed({ walletId: wallet._id });
      onResult?.(
        `${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged — ${result.rawRepeated} observations were already known.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant={variant} size="sm" disabled={busy} onClick={onClick}>
        {busy ? "Loading demo events…" : "Load demo events"}
      </Button>
      <InlineError message={error} />
    </div>
  );
}

export function InboxScreen({ wallets }: { wallets: Doc<"wallets">[] }) {
  const inbox = useQuery(api.events.getInbox);
  const now = useNow();
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  const primary = wallets[0];

  if (inbox === undefined) {
    return (
      <>
        <Header now={now} count={null} wallet={primary} />
        <LoadingState label="Loading your inbox…" />
      </>
    );
  }

  const { attention, snoozed, done } = inbox;
  const isEmpty = attention.length === 0 && snoozed.length === 0 && done.length === 0;

  return (
    <>
      <Header now={now} count={attention.length} wallet={primary} />

      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="pt-2 text-[13px] text-ink-muted" aria-live="polite">
          {seedMessage ?? ""}
        </p>
        <div className="flex items-start gap-2">
          {!isEmpty && (
            <SeedDemoButton
              wallet={primary}
              variant="secondary"
              onResult={setSeedMessage}
            />
          )}
          <RefreshWalletButton wallet={primary} />
        </div>
      </div>

      {isEmpty ? (
        <EmptyState
          title="Nothing here yet."
          description="Refresh the wallet to check live onchain sources (ENS today), or load the deterministic demo events to see how Numa prioritizes a full inbox."
          action={<SeedDemoButton wallet={primary} onResult={setSeedMessage} />}
        />
      ) : attention.length === 0 ? (
        <EmptyState
          title="You're all caught up."
          description="Nothing needs your attention right now. Snoozed and completed items are below."
        />
      ) : (
        <section aria-label="Needs attention" className="space-y-3">
          {attention.map((event) => (
            <InboxCard key={event._id} event={event} now={now} />
          ))}
        </section>
      )}

      {snoozed.length > 0 && (
        <section aria-labelledby="snoozed-heading" className="mt-10">
          <h2
            id="snoozed-heading"
            className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted"
          >
            Snoozed · {snoozed.length}
          </h2>
          <div className="space-y-3 opacity-90">
            {snoozed.map((event) => (
              <InboxCard key={event._id} event={event} now={now} />
            ))}
          </div>
        </section>
      )}

      {done.length > 0 && (
        <details className="mt-10 group">
          <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Done · {done.length}
          </summary>
          <ul className="mt-3 divide-y divide-line rounded-(--radius-card) border border-line bg-surface">
            {done.map((event) => (
              <li
                key={event._id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-[14px]"
              >
                <Link href={eventHref(event._id)} className="truncate text-ink-secondary line-through decoration-line-strong hover:text-ink">
                  {event.title}
                </Link>
                <span className="shrink-0 text-[12px] uppercase tracking-wide text-ink-muted">
                  {event.status}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function Header({
  now,
  count,
  wallet,
}: {
  now: number | null;
  count: number | null;
  wallet: Doc<"wallets">;
}) {
  const greeting = now === null ? "Hello." : greetingForHour(new Date(now).getHours());
  return (
    <header className="mb-8">
      <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-ink-muted">
        Numa
      </p>
      <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">
        {greeting}
      </h1>
      <p className="mt-2 text-[17px] text-ink-secondary" aria-live="polite">
        {count === null ? "Checking your inbox…" : attentionHeadline(count)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-mono text-[12px] text-ink-muted">
          {wallet.label ? `${wallet.label} · ` : ""}
          {shortenAddress(wallet.address, 6)}
        </p>
        <ScanHealth wallet={wallet} now={now} />
      </div>
    </header>
  );
}
