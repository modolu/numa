"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { validateWalletAddress } from "@/lib/validation/wallet";
import { Button } from "@/components/ui/Button";
import { InlineError } from "@/components/ui/States";
import { errorMessage } from "@/components/ui/errors";

/**
 * First-run empty state: paste one EVM address, validate it client-side for
 * fast feedback, persist it (validated again server-side), and let the
 * reactive wallet query move the user into the inbox.
 */
export function WalletOnboarding({ compact = false }: { compact?: boolean }) {
  const addWallet = useMutation(api.wallets.addWallet);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const validation = validateWalletAddress(address);
    if (!validation.ok) {
      setError(validation.reason);
      return;
    }
    setSubmitting(true);
    try {
      await addWallet({
        address: validation.address,
        label: label.trim() || undefined,
      });
      setAddress("");
      setLabel("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="onboarding-title"
      className={compact ? "" : "mx-auto max-w-lg pt-10"}
    >
      {!compact && (
        <header className="mb-8">
          <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-ink-muted">
            Numa
          </p>
          <h1
            id="onboarding-title"
            className="mt-3 text-[28px] font-semibold leading-tight tracking-tight"
          >
            Your onchain inbox.
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-ink-secondary">
            Paste a wallet address and Numa turns its deadlines, risks, claims
            and protocol changes into a short list of things that actually
            need you.
          </p>
        </header>
      )}

      <form
        onSubmit={onSubmit}
        className="rounded-(--radius-card) border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
        noValidate
      >
        <label htmlFor="wallet-address" className="block text-sm font-medium">
          {compact ? "Add a wallet" : "Wallet address"}
        </label>
        <input
          id="wallet-address"
          name="address"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="0x…"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby="wallet-address-help"
          className="mt-2 h-11 w-full rounded-lg border border-line-strong bg-surface px-3 font-mono text-[14px] placeholder:text-ink-muted focus:border-accent"
        />
        <p id="wallet-address-help" className="mt-2 text-[12px] text-ink-muted">
          Any EVM address (Ethereum, Arbitrum, Base…). Read-only — no
          signature, no seed phrase, ever.
        </p>

        <label htmlFor="wallet-label" className="mt-4 block text-sm font-medium">
          Label <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <input
          id="wallet-label"
          name="label"
          autoComplete="off"
          placeholder="Main wallet"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={40}
          className="mt-2 h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] placeholder:text-ink-muted focus:border-accent"
        />

        <div className="mt-5 flex items-center justify-between gap-4">
          <InlineError message={error} />
          <Button
            type="submit"
            variant="primary"
            disabled={submitting}
            className="ml-auto"
          >
            {submitting ? "Adding…" : "Start monitoring"}
          </Button>
        </div>
      </form>
    </section>
  );
}
