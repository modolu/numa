/**
 * Firecrawl implementation of the web-source adapter. Node-only (the SDK
 * needs Node built-ins), so it is imported solely from the `"use node"`
 * crawl action. Single-page `scrape()` only — Numa never crawls broadly.
 */
import Firecrawl from "@mendable/firecrawl-js";
import { ProviderError, toProviderError } from "../providers/errors";
import {
  MAX_SCRAPED_CONTENT_CHARS,
  type ScrapedSource,
  type SourceTarget,
  type WebSourceAdapter,
} from "./provider";

export const FIRECRAWL_PROVIDER = "firecrawl";
const SCRAPE_TIMEOUT_MS = 30_000;

export type FirecrawlAdapterOptions = {
  apiKey: string | undefined;
  now?: () => number;
  /** Test seam: replaces the SDK call. */
  scrapeImpl?: (url: string) => Promise<unknown>;
};

/** Narrow an SDK response into Numa's shape; anything unexpected is malformed. */
export function mapFirecrawlDocument(doc: unknown, fetchedAt: number): ScrapedSource {
  if (typeof doc !== "object" || doc === null) {
    throw new ProviderError("Empty scrape response", "malformed", FIRECRAWL_PROVIDER);
  }
  const record = doc as Record<string, unknown>;
  const markdown = record.markdown;
  if (typeof markdown !== "string" || markdown.trim().length === 0) {
    throw new ProviderError("Scrape returned no markdown content", "malformed", FIRECRAWL_PROVIDER);
  }
  const metadata =
    typeof record.metadata === "object" && record.metadata !== null
      ? (record.metadata as Record<string, unknown>)
      : {};
  const statusCode = typeof metadata.statusCode === "number" ? metadata.statusCode : undefined;
  if (statusCode !== undefined && statusCode >= 400) {
    throw new ProviderError(
      `Source responded with HTTP ${statusCode}`,
      statusCode === 429 || statusCode >= 500 ? "transient" : "permanent",
      FIRECRAWL_PROVIDER,
      statusCode,
    );
  }
  return {
    content: markdown.length > MAX_SCRAPED_CONTENT_CHARS ? markdown.slice(0, MAX_SCRAPED_CONTENT_CHARS) : markdown,
    title: typeof metadata.title === "string" ? metadata.title.slice(0, 300) : undefined,
    description:
      typeof metadata.description === "string" ? metadata.description.slice(0, 500) : undefined,
    finalUrl: typeof metadata.url === "string" ? metadata.url : undefined,
    statusCode,
    fetchedAt,
  };
}

export function createFirecrawlAdapter(options: FirecrawlAdapterOptions): WebSourceAdapter {
  const now = options.now ?? (() => Date.now());
  const scrapeImpl =
    options.scrapeImpl ??
    (async (url: string) => {
      if (!options.apiKey) {
        throw new ProviderError(
          "FIRECRAWL_API_KEY is not configured on this deployment",
          "permanent",
          FIRECRAWL_PROVIDER,
        );
      }
      const client = new Firecrawl({ apiKey: options.apiKey });
      return await client.scrape(url, {
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: SCRAPE_TIMEOUT_MS,
      });
    });

  return {
    provider: FIRECRAWL_PROVIDER,
    providerLabel: "Firecrawl scrape",
    async scrape(source: SourceTarget): Promise<ScrapedSource> {
      let doc: unknown;
      try {
        doc = await scrapeImpl(source.url);
      } catch (error) {
        throw toProviderError(error, FIRECRAWL_PROVIDER);
      }
      return mapFirecrawlDocument(doc, now());
    },
  };
}
