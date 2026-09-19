"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { LoadingState } from "@/components/ui/States";
import { WalletOnboarding } from "./WalletOnboarding";
import type { ReactNode } from "react";

/**
 * Routes between onboarding (no wallet yet) and the product surface.
 * Driven entirely by the reactive `getWallets` query, so adding a wallet
 * transitions the screen without navigation.
 */
export function WalletGate({
  children,
}: {
  children: (wallets: Doc<"wallets">[]) => ReactNode;
}) {
  const wallets = useQuery(api.wallets.getWallets);

  if (wallets === undefined) {
    return <LoadingState label="Loading your wallets…" />;
  }
  if (wallets.length === 0) {
    return <WalletOnboarding />;
  }
  return <>{children(wallets)}</>;
}
