import type { Metadata } from "next";
import { WalletsRoute } from "@/components/wallet/WalletsRoute";

export const metadata: Metadata = { title: "Wallets" };

export default function WalletsPage() {
  return <WalletsRoute />;
}
