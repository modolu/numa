import type { Metadata } from "next";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { EventDetail } from "@/components/event/EventDetail";

export const metadata: Metadata = { title: "Event" };

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <ErrorBoundary label="This event">
      <EventDetail eventId={id} />
    </ErrorBoundary>
  );
}
