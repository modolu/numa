"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { EmptyState } from "@/components/ui/States";
import { EventDetail } from "./EventDetail";

export function eventHref(eventId: string): string {
  return `/event?id=${encodeURIComponent(eventId)}`;
}

export function EventRoute() {
  const params = useSearchParams();
  const id = params.get("id");
  if (!id) {
    return (
      <EmptyState
        title="No event selected."
        action={<Link href="/inbox" className="text-sm font-medium text-accent hover:underline">Back to inbox</Link>}
      />
    );
  }
  return (
    <ErrorBoundary label="This event">
      <EventDetail eventId={id} />
    </ErrorBoundary>
  );
}
