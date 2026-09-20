"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { LoadingState } from "@/components/ui/States";
import { useNow } from "@/components/ui/useNow";
import { WalletOnboarding } from "./WalletOnboarding";
import { RefreshWalletButton } from "./RefreshWalletButton";
import { ScanHealth } from "./ScanHealth";

function WalletsScreen() {
  const wallets = useQuery(api.wallets.getWallets);
  const now = useNow();

  return (
    <>
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Wallets</h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          Addresses Numa monitors, read-only.
        </p>
      </header>

      {wallets === undefined ? (
        <LoadingState label="Loading wallets…" />
      ) : wallets.length > 0 ? (
        <ul className="divide-y divide-line rounded-(--radius-card) border border-line bg-surface">
          {wallets.map((wallet) => (
            <li key={wallet._id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[15px] font-medium">
                  {wallet.label ?? "Wallet"}
                  {wallet.isPrimary && (
                    <span className="ml-2 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
                      Primary
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate font-mono text-[13px] text-ink-secondary">
                  {wallet.address}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <RefreshWalletButton wallet={wallet} />
                <ScanHealth wallet={wallet} now={now} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-8">
        <WalletOnboarding compact />
      </div>
    </>
  );
}

export function WalletsRoute() {
  return (
    <ErrorBoundary label="Wallets">
      <WalletsScreen />
    </ErrorBoundary>
  );
}
