/**
 * Provider-neutral web-source adapter boundary (NUMA_ARCHITECTURE.md §12.2,
 * §13). Mirrors the onchain adapter: the rest of Numa sees only
 * `ScrapedSource`, never a Firecrawl response.
 *
 * Crawled content is untrusted data (§27): it is normalized, hashed and
 * stored, never interpreted as instructions and never fed to a tool.
 */
import type { ProtocolSourceType } from "../events/raw";

export type SourceTarget = {
  id: string;
  url: string;
  sourceType: ProtocolSourceType;
  protocolSlug: string;
};

export type ScrapedSource = {
  /** Clean text/markdown of the page's main content, size-bounded. */
  content: string;
  title?: string;
  description?: string;
  /** URL the provider actually fetched (after redirects), if reported. */
  finalUrl?: string;
  statusCode?: number;
  fetchedAt: number;
};

export interface WebSourceAdapter {
  /** Stable provider id, e.g. "firecrawl". Becomes `rawEvents.source`. */
  readonly provider: string;
  readonly providerLabel: string;
  scrape(source: SourceTarget): Promise<ScrapedSource>;
}

/** Hard cap on content accepted from a provider before normalization. */
export const MAX_SCRAPED_CONTENT_CHARS = 200_000;
