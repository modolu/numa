import type { Metadata } from "next";
import { SettingsRoute } from "@/components/settings/SettingsRoute";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <SettingsRoute />;
}
