"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";

/**
 * The only environment variable the browser needs is the public Convex URL.
 * Everything else (provider keys, deployment name) stays server-side.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
    [],
  );

  if (!client) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-lg font-semibold">Numa is not connected to Convex.</h1>
        <p className="mt-3 text-sm text-ink-secondary">
          <code className="font-mono">NEXT_PUBLIC_CONVEX_URL</code> is not set.
          Run <code className="font-mono">npx convex dev</code> once to provision a
          deployment and write it to <code className="font-mono">.env.local</code>.
        </p>
      </main>
    );
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
