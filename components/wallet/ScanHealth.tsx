"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { formatRelative } from "@/lib/formatting/time";

/**
 * Visible scan/provider state (§45): never hide stale data. A failed scan
 * keeps the last successful check on screen so the user knows how old the
 * live information is.
 */
export function ScanHealth({
  wallet,
  now,
}: {
  wallet: Doc<"wallets">;
  now: number | null;
}) {
  const last = wallet.lastScannedAt;
  const lastText =
    last !== undefined && now !== null ? formatRelative(last, now) : null;

  if (wallet.lastScanStatus === "failed") {
    return (
      <p role="status" className="text-[12px] text-sev-high">
        Onchain provider unavailable
        {lastText ? ` · last successful check ${lastText}` : " · no successful check yet"}
      </p>
    );
  }
  if (wallet.lastScanStatus === "running") {
    return <p role="status" className="text-[12px] text-ink-muted">Scanning onchain sources…</p>;
  }
  if (last === undefined) {
    return <p role="status" className="text-[12px] text-ink-muted">Not scanned yet</p>;
  }
  return (
    <p role="status" className="text-[12px] text-ink-muted">
      Onchain check {lastText ?? "…"}
    </p>
  );
}
