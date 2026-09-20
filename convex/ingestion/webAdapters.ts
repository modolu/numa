"use node";
/**
 * Registry of web-source adapters used by source crawls. Node-only because
 * the Firecrawl SDK needs Node built-ins. Tests replace this module with a
 * fake adapter; adding a second provider is a one-line change here.
 *
 * `FIRECRAWL_API_KEY` is a server-side Convex deployment env var. It is read
 * here and nowhere else, and never leaves the action.
 */
import type { WebSourceAdapter } from "../../lib/web/provider";
import { createFirecrawlAdapter } from "../../lib/web/firecrawl";

export function createWebSourceAdapter(): WebSourceAdapter {
  return createFirecrawlAdapter({ apiKey: process.env.FIRECRAWL_API_KEY || undefined });
}
