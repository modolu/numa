import { describe, expect, test } from "vitest";
import { normalizeContent, boundContent, excerptOf, MAX_STORED_CONTENT_CHARS } from "../../lib/web/normalizeContent";
import { hashContent, shortHash } from "../../lib/web/hashContent";
import { validateOfficialSource } from "../../lib/web/sources";
import { createFirecrawlAdapter, mapFirecrawlDocument } from "../../lib/web/firecrawl";
import { CRAWL_INTERVAL_MS, isCrawlDue } from "../../lib/web/crawlPolicy";
import { sanitizeProviderMessage } from "../../lib/providers/errors";

const target = { id: "src1", url: "https://docs.ens.domains/", sourceType: "docs" as const, protocolSlug: "ens" };

describe("content normalization", () => {
  test("is deterministic across whitespace and line-ending noise", () => {
    const a = "# Title\r\n\r\n\r\nSome   text\twith  spaces  \n\n\n\nMore text​\n";
    const b = "# Title\n\nSome text with spaces\n\nMore text";
    expect(normalizeContent(a)).toBe(b);
    expect(normalizeContent(b)).toBe(b);
    expect(normalizeContent(normalizeContent(a))).toBe(normalizeContent(a));
  });

  test("does not rewrite semantic content", () => {
    const text = "Vote closes on **March 3** at 12:00 UTC. Proposal #441.";
    expect(normalizeContent(text)).toBe(text);
  });

  test("bounds stored content and excerpts", () => {
    const big = "x".repeat(MAX_STORED_CONTENT_CHARS + 100);
    expect(boundContent(big).length).toBeLessThan(big.length);
    expect(boundContent(big)).toMatch(/\[truncated\]$/);
    expect(excerptOf("short")).toBe("short");
    expect(excerptOf("y".repeat(5000)).length).toBe(2001);
  });
});

describe("content hashing", () => {
  test("same normalized text → same hash; any change → different hash", async () => {
    const h1 = await hashContent("hello\nworld");
    const h2 = await hashContent("hello\nworld");
    const h3 = await hashContent("hello\nworld!");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(shortHash(h1)).toHaveLength(12);
  });

  test("whitespace-only differences hash identically after normalization", async () => {
    const a = await hashContent(normalizeContent("A  b\r\n\r\n\r\nC"));
    const b = await hashContent(normalizeContent("A b\n\nC"));
    expect(a).toBe(b);
  });
});

describe("official source validation", () => {
  const hosts = ["ens.domains"];
  test("accepts https URLs on the protocol's official hosts (and subdomains)", () => {
    expect(validateOfficialSource({ protocolSlug: "ens", url: "https://docs.ens.domains/#top", sourceType: "docs" }, hosts))
      .toEqual({ ok: true, url: "https://docs.ens.domains/", hostname: "docs.ens.domains" });
    expect(validateOfficialSource({ protocolSlug: "ens", url: "https://ens.domains/blog", sourceType: "blog" }, hosts).ok).toBe(true);
  });
  test("rejects http, foreign hosts, lookalikes, credentials, bad types and empty allow-lists", () => {
    const bad = (url: string, sourceType = "docs" as const, allowed = hosts) =>
      validateOfficialSource({ protocolSlug: "ens", url, sourceType }, allowed);
    expect(bad("http://docs.ens.domains/")).toMatchObject({ ok: false, reason: /https/ });
    expect(bad("https://evil.example/ens.domains")).toMatchObject({ ok: false, reason: /not an official host/ });
    expect(bad("https://ens.domains.evil.example/")).toMatchObject({ ok: false });
    expect(bad("https://fakeens.domains/")).toMatchObject({ ok: false });
    expect(bad("https://user:pw@docs.ens.domains/")).toMatchObject({ ok: false, reason: /Credentials/ });
    expect(bad("not a url")).toMatchObject({ ok: false, reason: /valid URL/ });
    expect(validateOfficialSource({ protocolSlug: "ens", url: "https://docs.ens.domains/", sourceType: "tweets" as never }, hosts)).toMatchObject({ ok: false, reason: /source type/ });
    expect(bad("https://docs.ens.domains/", "docs", [])).toMatchObject({ ok: false, reason: /No official hosts/ });
  });
});

describe("Firecrawl adapter mapping", () => {
  test("maps a document into Numa's ScrapedSource", () => {
    const scraped = mapFirecrawlDocument(
      { markdown: "# Docs\n\nHello", metadata: { title: "ENS Docs", statusCode: 200, url: "https://docs.ens.domains/", description: "d" } },
      123,
    );
    expect(scraped).toEqual({
      content: "# Docs\n\nHello",
      title: "ENS Docs",
      description: "d",
      finalUrl: "https://docs.ens.domains/",
      statusCode: 200,
      fetchedAt: 123,
    });
  });
  test("rejects malformed responses", () => {
    expect(() => mapFirecrawlDocument(null, 1)).toThrow(/Empty/);
    expect(() => mapFirecrawlDocument({ metadata: {} }, 1)).toThrow(/no markdown/);
    expect(() => mapFirecrawlDocument({ markdown: "   " }, 1)).toThrow(/no markdown/);
  });
  test("classifies upstream HTTP status", () => {
    expect(() => mapFirecrawlDocument({ markdown: "x", metadata: { statusCode: 404 } }, 1)).toThrow(expect.objectContaining({ kind: "permanent", status: 404 }));
    expect(() => mapFirecrawlDocument({ markdown: "x", metadata: { statusCode: 503 } }, 1)).toThrow(expect.objectContaining({ kind: "transient" }));
  });
  test("adapter uses the seam and wraps failures; missing key is permanent", async () => {
    const ok = createFirecrawlAdapter({ apiKey: "k", now: () => 5, scrapeImpl: async () => ({ markdown: "body", metadata: { title: "T" } }) });
    expect(await ok.scrape(target)).toMatchObject({ content: "body", title: "T", fetchedAt: 5 });

    const boom = createFirecrawlAdapter({ apiKey: "k", scrapeImpl: async () => { throw Object.assign(new Error("Unauthorized: Invalid token"), { status: 401 }); } });
    await expect(boom.scrape(target)).rejects.toMatchObject({ kind: "permanent", status: 401, source: "firecrawl" });

    const down = createFirecrawlAdapter({ apiKey: "k", scrapeImpl: async () => { throw new Error("fetch failed https://api.firecrawl.dev/v2/scrape?key=fc-abc123456"); } });
    await expect(down.scrape(target)).rejects.toMatchObject({ kind: "transient", message: "fetch failed [endpoint]" });

    const noKey = createFirecrawlAdapter({ apiKey: undefined });
    await expect(noKey.scrape(target)).rejects.toMatchObject({ kind: "permanent", message: /FIRECRAWL_API_KEY/ });
  });
  test("sanitizer redacts key-shaped tokens in messages", () => {
    expect(sanitizeProviderMessage(new Error("bad key fc-abcdef123456 rejected"))).toBe("bad key [redacted] rejected");
  });
});

describe("crawl policy", () => {
  test("cadences follow the architecture guidance and gate due checks", () => {
    expect(CRAWL_INTERVAL_MS.governance).toBe(30 * 60_000);
    expect(CRAWL_INTERVAL_MS.status).toBe(10 * 60_000);
    expect(CRAWL_INTERVAL_MS.docs).toBe(6 * 3_600_000);
    expect(CRAWL_INTERVAL_MS.static).toBe(24 * 3_600_000);
    const now = 10_000_000_000;
    expect(isCrawlDue("governance", undefined, now)).toBe(true);
    expect(isCrawlDue("governance", now - 10 * 60_000, now)).toBe(false);
    expect(isCrawlDue("governance", now - 31 * 60_000, now)).toBe(true);
  });
});
