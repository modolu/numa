"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { DemoBadge, LiveBadge } from "@/components/ui/Badge";
import { EVENT_TYPE_LABEL } from "@/lib/formatting/events";
import type { EventType } from "@/lib/validation/events";

/**
 * Protocol exposure derived from the wallet's own events. Live exposure comes
 * from onchain observations; demo exposure only from fixtures — shown
 * separately so nobody mistakes fixture data for wallet analysis.
 */
export function Subscriptions() {
  const subs = useQuery(api.subscriptions.getSubscriptions);
  if (subs === undefined) return null;

  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-medium">Protocol exposure</h2>
      <p className="mt-1 text-[13px] leading-5 text-ink-secondary">
        Numa only monitors official updates for protocols your wallet is exposed to.
      </p>
      {subs.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-muted">
          No exposure detected yet. Refresh the wallet or load demo events.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-(--radius-card) border border-line bg-surface">
          {subs.map((s) => (
            <li key={s._id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium">{s.protocol.name}</p>
                <p className="truncate text-[12px] text-ink-muted">
                  From {s.evidence.map((e) => EVENT_TYPE_LABEL[e as EventType] ?? e).join(", ")}
                </p>
              </div>
              {s.origin === "live" ? <LiveBadge /> : <DemoBadge />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
