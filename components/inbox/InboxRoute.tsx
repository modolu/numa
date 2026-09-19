"use client";

import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { WalletGate } from "@/components/wallet/WalletGate";
import { InboxScreen } from "./InboxScreen";

export function InboxRoute() {
  return (
    <ErrorBoundary label="Your inbox">
      <WalletGate>{(wallets) => <InboxScreen wallets={wallets} />}</WalletGate>
    </ErrorBoundary>
  );
}
