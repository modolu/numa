import type { Metadata } from "next";
import { Suspense } from "react";
import { EventRoute } from "@/components/event/EventRoute";

export const metadata: Metadata = { title: "Event" };

/**
 * Event detail lives at `/event?id=<eventId>`: a static export cannot emit
 * arbitrary dynamic paths, and the id is only meaningful to the Convex
 * client anyway. `useSearchParams` requires a Suspense boundary in exports.
 */
export default function EventPage() {
  return (
    <Suspense fallback={null}>
      <EventRoute />
    </Suspense>
  );
}
