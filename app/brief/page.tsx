import type { Metadata } from "next";
import { BriefRoute } from "@/components/brief/BriefRoute";

export const metadata: Metadata = { title: "Brief" };

export default function BriefPage() {
  return <BriefRoute />;
}
