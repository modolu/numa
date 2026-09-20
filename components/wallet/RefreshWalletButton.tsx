"use client";

import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/errors";

const COOLDOWN_MS = 15_000;

type Feedback =
  | { tone: "neutral" | "success" | "error"; text: string }
  | null;

/**
 * Triggers a live wallet scan. Feedback here is about the *scan request*;
 * the inbox itself updates through Convex subscriptions when the scan
 * writes, never by polling from this button.
 */
export function RefreshWalletButton({
  wallet,
  size = "sm",
}: {
  wallet: Doc<"wallets">;
  size?: "sm" | "md";
}) {
  const scan = useAction(api.ingestion.wallet.scanWallet);
  const [running, setRunning] = useState(false);
  const [coolingDown, setCoolingDown] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  async function onClick() {
    if (running || coolingDown) return;
    setRunning(true);
    setFeedback({ tone: "neutral", text: "Scanning…" });
    try {
      const result = await scan({ walletId: wallet._id });
      if (result.status === "ok") {
        const s = result.summary;
        const found = s.created + s.updated + s.unchanged;
        setFeedback({
          tone: "success",
          text:
            found === 0
              ? result.skipped[0]
                ? `Updated · ${result.skipped[0].reason}`
                : "Updated · nothing found for this wallet yet"
              : `Updated · ${s.created} new, ${s.updated} changed, ${s.unchanged} unchanged`,
        });
      } else if (result.status === "failed") {
        setFeedback({
          tone: "error",
          text: result.retryable
            ? "Provider unavailable — last known data kept. Try again in a moment."
            : `Provider rejected the request — ${result.error}`,
        });
      } else {
        setFeedback({ tone: "neutral", text: result.reason });
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
    feedback?.tone === "error"
      ? "text-sev-critical"
      : feedback?.tone === "success"
        ? "text-success"
        : "text-ink-muted";

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        size={size}
        variant="secondary"
        disabled={running || coolingDown}
        aria-busy={running}
        onClick={onClick}
        title={coolingDown && !running ? "Please wait a few seconds between scans" : undefined}
      >
        {running ? "Scanning…" : "Refresh wallet"}
      </Button>
      {feedback && (
        <p role="status" aria-live="polite" className={`text-[12px] ${toneClass}`}>
          {feedback.text}
        </p>
      )}
    </div>
  );
}
