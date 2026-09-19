"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Client clock for relative times ("in 7h", "5m ago"). The server snapshot
 * is `null` so server and first client render match; afterwards the value
 * ticks on `intervalMs` boundaries.
 */
export function useNow(intervalMs = 30_000): number | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const id = window.setInterval(onChange, intervalMs);
      return () => window.clearInterval(id);
    },
    [intervalMs],
  );
  const getSnapshot = useCallback(
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    [intervalMs],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
