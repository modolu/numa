"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/Button";
import { InlineError } from "@/components/ui/States";
import { errorMessage } from "@/components/ui/errors";
import { canComplete, canTransition } from "@/convex/lib/lifecycle";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const SNOOZE_OPTIONS = [
  { label: "1 hour", ms: HOUR },
  { label: "Tomorrow", ms: DAY },
  { label: "3 days", ms: 3 * DAY },
] as const;

type Props = {
  event: Pick<Doc<"events">, "_id" | "status" | "requiresAction">;
  /** Compact row for cards; full row for the detail page. */
  layout?: "card" | "detail";
};

/**
 * Lifecycle controls shared by inbox cards and the event detail page. Every
 * action is a Convex mutation; the surrounding query re-renders reactively,
 * so there is no local optimistic state to keep in sync.
 */
export function EventActions({ event, layout = "card" }: Props) {
  const markRead = useMutation(api.events.markRead);
  const snooze = useMutation(api.events.snoozeEvent);
  const unsnooze = useMutation(api.events.unsnoozeEvent);
  const dismiss = useMutation(api.events.dismissEvent);
  const complete = useMutation(api.events.completeEvent);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
      setSnoozeOpen(false);
    }
  }

  const size = layout === "card" ? "sm" : "md";
  const showRead = event.status === "unread";
  const showSnooze = canTransition(event.status, "snoozed");
  const showUnsnooze = event.status === "snoozed";
  const showComplete = canComplete(event);
  const showDismiss = canTransition(event.status, "dismissed");

  if (!showRead && !showSnooze && !showUnsnooze && !showComplete && !showDismiss) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {showComplete && (
        <Button
          size={size}
          variant={layout === "detail" ? "primary" : "secondary"}
          disabled={busy !== null}
          onClick={() => run("complete", () => complete({ eventId: event._id }))}
        >
          {busy === "complete" ? "Completing…" : "Mark done"}
        </Button>
      )}
      {showRead && (
        <Button
          size={size}
          variant="ghost"
          disabled={busy !== null}
          onClick={() => run("read", () => markRead({ eventId: event._id }))}
        >
          {busy === "read" ? "…" : "Mark read"}
        </Button>
      )}
      {showUnsnooze && (
        <Button
          size={size}
          variant="ghost"
          disabled={busy !== null}
          onClick={() => run("unsnooze", () => unsnooze({ eventId: event._id }))}
        >
          {busy === "unsnooze" ? "…" : "Unsnooze"}
        </Button>
      )}
      {showSnooze && (
        <div className="relative">
          <Button
            size={size}
            variant="ghost"
            disabled={busy !== null}
            aria-haspopup="menu"
            aria-expanded={snoozeOpen}
            onClick={() => setSnoozeOpen((open) => !open)}
          >
            {busy === "snooze" ? "…" : "Snooze"}
          </Button>
          {snoozeOpen && (
            <div
              role="menu"
              aria-label="Snooze until"
              className="absolute left-0 top-full z-20 mt-1 min-w-36 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg"
            >
              {SNOOZE_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  role="menuitem"
                  type="button"
                  className="block w-full px-3 py-2 text-left text-[13px] hover:bg-surface-muted"
                  onClick={() =>
                    run("snooze", () =>
                      snooze({ eventId: event._id, until: Date.now() + option.ms }),
                    )
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {showDismiss && (
        <Button
          size={size}
          variant="ghost"
          disabled={busy !== null}
          onClick={() => run("dismiss", () => dismiss({ eventId: event._id }))}
        >
          {busy === "dismiss" ? "…" : "Dismiss"}
        </Button>
      )}
      {error && (
        <div className="basis-full pt-1">
          <InlineError message={error} />
        </div>
      )}
    </div>
  );
}
