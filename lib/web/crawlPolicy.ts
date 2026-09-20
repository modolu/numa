/**
 * Crawl cadences (NUMA_ARCHITECTURE.md §42). Chosen for a hackathon budget:
 * governance pages change on human timescales, docs rarely.
 */
export const CRAWL_POLICIES = [
  "governance",
  "status",
  "updates",
  "docs",
  "static",
] as const;
export type CrawlPolicy = (typeof CRAWL_POLICIES)[number];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const CRAWL_INTERVAL_MS: Record<CrawlPolicy, number> = {
  governance: 30 * MINUTE,
  status: 10 * MINUTE,
  updates: 3 * HOUR,
  docs: 6 * HOUR,
  static: 24 * HOUR,
};

export function isCrawlDue(
  policy: CrawlPolicy,
  lastAttemptAt: number | undefined,
  now: number,
): boolean {
  if (lastAttemptAt === undefined) return true;
  return now - lastAttemptAt >= CRAWL_INTERVAL_MS[policy];
}
