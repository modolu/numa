/**
 * Stable content hash for change detection: SHA-256 over the normalized
 * text via WebCrypto, available in the Convex runtimes, Node and the
 * edge-runtime test environment alike. Numa owns this comparison; provider
 * change-tracking features are not relied upon.
 */

export async function hashContent(normalized: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Short, human-friendly version for UI/debug labels. */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
