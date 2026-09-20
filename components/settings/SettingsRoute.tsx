"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/Button";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { InlineError } from "@/components/ui/States";
import { errorMessage } from "@/components/ui/errors";
import { MonitoredSources } from "@/components/sources/MonitoredSources";

function SettingsScreen() {
  const me = useQuery(api.users.me);
  const reset = useMutation(api.ingestion.fixtures.resetDemoData);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onReset() {
    if (!window.confirm("Remove all inbox items, tasks and raw observations for this account?")) {
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
          Notification and digest preferences arrive with the brief milestone.
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
                ? "You are using the temporary hackathon demo identity. Real sign-in is deferred to a later milestone; every read and write is still scoped to this account."
                : `Signed in as ${me.displayName ?? "user"}.`}
        </p>
      </section>

      <MonitoredSources />

      <section className="mt-6 rounded-(--radius-card) border border-line bg-surface p-5">
        <h2 className="text-[15px] font-medium">Demo data</h2>
        <p className="mt-2 text-[14px] leading-6 text-ink-secondary">
          Clear inbox items, tasks and raw observations so the demo seed can be
          shown from an empty inbox. Wallets are kept.
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
