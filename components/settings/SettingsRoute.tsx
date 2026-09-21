"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/Button";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { InlineError } from "@/components/ui/States";
import { errorMessage } from "@/components/ui/errors";
import { MonitoredSources } from "@/components/sources/MonitoredSources";
import { EmailSettings } from "@/components/notifications/EmailSettings";
import { NotificationHistory } from "@/components/notifications/NotificationHistory";

function SettingsScreen() {
  const me = useQuery(api.users.me);
  const reset = useMutation(api.ingestion.fixtures.resetDemoData);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onReset() {
    if (!window.confirm("Remove all inbox items, tasks, notifications and raw observations for the shared demo workspace? Every visitor will see the empty state until demo events are loaded again.")) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await reset({});
      setMessage(`Removed ${result.removed} records. Wallets were kept.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Settings</h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          Email delivery, monitored sources and demo controls.
        </p>
      </header>

      <section className="rounded-(--radius-card) border border-line bg-surface p-5">
        <h2 className="text-[15px] font-medium">Account</h2>
        <p className="mt-2 text-[14px] leading-6 text-ink-secondary">
          {me === undefined
            ? "…"
            : me === null
              ? "No account yet — it is created the first time you add a wallet."
              : me.isDemoIdentity
                ? "Shared demo workspace: this deployment uses one hackathon demo identity, so every visitor sees and edits the same demo wallet and inbox. Real sign-in is deferred to a later milestone; ownership checks are already enforced on every read and write."
                : `Signed in as ${me.displayName ?? "user"}.`}
        </p>
      </section>

      <EmailSettings />

      <NotificationHistory />

      <MonitoredSources />

      <section className="mt-6 rounded-(--radius-card) border border-line bg-surface p-5">
        <h2 className="text-[15px] font-medium">Demo data</h2>
        <p className="mt-2 text-[14px] leading-6 text-ink-secondary">
          Clear inbox items, tasks, notifications and raw observations so the demo
          seed can be shown from an empty inbox. Wallets are kept. This affects the
          shared demo workspace for everyone.
        </p>
        <div className="mt-4 flex items-center gap-4">
          <Button variant="danger" size="sm" disabled={busy} onClick={onReset}>
            {busy ? "Resetting…" : "Reset demo data"}
          </Button>
          {message && <p className="text-[13px] text-ink-muted">{message}</p>}
          <InlineError message={error} />
        </div>
      </section>
    </>
  );
}

export function SettingsRoute() {
  return (
    <ErrorBoundary label="Settings">
      <SettingsScreen />
    </ErrorBoundary>
  );
}
