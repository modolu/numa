import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/States";

export const metadata: Metadata = { title: "Brief" };

export default function BriefPage() {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Your Numa brief</h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          A short daily digest of the few items that matter, generated from your
          already-prioritized inbox.
        </p>
      </header>
      <EmptyState
        title="Briefs arrive in a later milestone."
        description="The brief will rank today's inbox, select the top items, and deliver them in-app and by email."
      />
    </>
  );
}
