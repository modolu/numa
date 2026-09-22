"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { InlineError, LoadingState } from "@/components/ui/States";
import { errorMessage } from "@/components/ui/errors";
import { EVENT_SEVERITIES, type EventSeverity } from "@/lib/validation/events";
import { SEVERITY_LABEL } from "@/lib/formatting/events";

const TIMEZONES = ["UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-4 py-3 text-[14px]">
      <span>{label}</span>
      <input type="checkbox" role="switch" aria-checked={checked} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-accent" />
    </label>
  );
}

export function EmailSettings() {
  const prefs = useQuery(api.notifications.getPreferences);
  const save = useMutation(api.notifications.setPreferences);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function update(patch: Parameters<typeof save>[0]) {
    setSaving(true);
    setError(null);
    try {
      await save(patch);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 break-inside-avoid rounded-(--radius-card) border border-line bg-surface p-5">
      <h2 className="text-[15px] font-medium">Email notifications</h2>
      <p className="mt-1 max-w-3xl text-[13px] leading-5 text-ink-secondary">
        A daily brief of the few items that matter, urgent alerts for actionable high-priority items, and deadline reminders 24h and 1h before.
      </p>
      {prefs === undefined ? (
        <div className="mt-4"><LoadingState label="Loading preferences…" /></div>
      ) : prefs === null ? (
        <p className="mt-4 text-[13px] text-ink-muted">Add a wallet first.</p>
      ) : (
        <div className="mt-3 divide-y divide-line">
          <div className="py-3 text-[14px]">
            <p>
              Recipient:{" "}
              {prefs.recipient.configured ? (
                <span className="font-mono text-[13px]">{prefs.recipient.masked}</span>
              ) : (
                <span className="text-sev-high">not configured</span>
              )}
              <span className="text-ink-muted"> · Sender: {prefs.senderConfigured ? "configured" : "not configured"}</span>
            </p>
            {!prefs.recipient.configured && (
              <p className="mt-1 text-[12px] text-ink-muted">Email delivery is not configured. Set NUMA_DEV_RECIPIENT_EMAIL on the Convex deployment for the development recipient.</p>
            )}
          </div>
          <Toggle label="Daily brief" checked={prefs.emailDigestEnabled} disabled={saving} onChange={(v) => update({ emailDigestEnabled: v })} />
          <Toggle label="Urgent alerts and deadline reminders" checked={prefs.urgentEmailEnabled} disabled={saving} onChange={(v) => update({ urgentEmailEnabled: v })} />
          <label className="flex items-center justify-between gap-4 py-3 text-[14px]">
            <span>Minimum alert severity <span className="text-ink-muted">(never below medium)</span></span>
            <select value={prefs.minimumEmailSeverity} disabled={saving} onChange={(e) => update({ minimumEmailSeverity: e.target.value as EventSeverity })} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]">
              {EVENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-4 py-3 text-[14px]">
            <span>Digest time</span>
            <input type="time" value={prefs.digestTime} disabled={saving} onChange={(e) => e.target.value && update({ digestTime: e.target.value })} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]" />
          </label>
          <label className="flex items-center justify-between gap-4 py-3 text-[14px]">
            <span>Timezone</span>
            <select value={prefs.timezone} disabled={saving} onChange={(e) => update({ timezone: e.target.value })} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]">
              {(TIMEZONES.includes(prefs.timezone) ? TIMEZONES : [prefs.timezone, ...TIMEZONES]).map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </label>
          <InlineError message={error} />
        </div>
      )}
    </section>
  );
}
