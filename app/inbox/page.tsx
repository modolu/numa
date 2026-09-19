import type { Metadata } from "next";
import { InboxRoute } from "@/components/inbox/InboxRoute";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage() {
  return <InboxRoute />;
}
