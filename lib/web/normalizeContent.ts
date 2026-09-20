/**
 * Deterministic content normalization before hashing (NUMA_ARCHITECTURE.md
 * §14). Conservative on purpose: whitespace, line endings and invisible
 * characters only — semantic content is never rewritten, so the same page
 * always produces the same normalized text and hash.
 */
import { MAX_SCRAPED_CONTENT_CHARS } from "./provider";

/** Stored per source; enough for audit and later interpretation. */
export const MAX_STORED_CONTENT_CHARS = 24_000;
/** Carried on a change raw event / shown in provenance. */
export const MAX_EXCERPT_CHARS = 2_000;

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

export function normalizeContent(input: string): string {
  const bounded = input.length > MAX_SCRAPED_CONTENT_CHARS
    ? input.slice(0, MAX_SCRAPED_CONTENT_CHARS)
    : input;
  const lines = bounded
    .replace(ZERO_WIDTH, "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());

  // Collapse runs of blank lines to a single blank line.
  const out: string[] = [];
  let blank = false;
  for (const line of lines) {
    if (line === "") {
      if (!blank) out.push("");
      blank = true;
    } else {
      out.push(line);
      blank = false;
    }
  }
  return out.join("\n").trim();
}

export function boundContent(content: string, max = MAX_STORED_CONTENT_CHARS): string {
  return content.length > max ? `${content.slice(0, max)}\n…[truncated]` : content;
}

export function excerptOf(content: string, max = MAX_EXCERPT_CHARS): string {
  const firstChunk = content.slice(0, max);
  return content.length > max ? `${firstChunk.trimEnd()}…` : firstChunk;
}
