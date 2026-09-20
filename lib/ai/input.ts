/**
 * Builds the compact interpretation input (§6, §15) and its identity hash.
 * The excerpt is bounded here; nothing else about the page is sent.
 */
import { contentHash } from "../../convex/lib/hash";
import type { ProtocolSourceType } from "../events/raw";
import { PROMPT_VERSION } from "./prompts";
import { INTERPRETATION_SCHEMA_VERSION } from "./schemas";
import {
  MAX_INTERPRETATION_EXCERPT_CHARS,
  type ExposureContext,
  type InterpretationInput,
} from "./provider";

export const INTERPRETATION_VERSION = `p${PROMPT_VERSION}.s${INTERPRETATION_SCHEMA_VERSION}`;

export type BuildInputArgs = {
  protocol: { slug: string; name: string };
  source: { url: string; sourceType: ProtocolSourceType; title?: string; previousHash: string; currentHash: string };
  content: string;
  exposure: ExposureContext;
  now: number;
};

export function boundExcerpt(content: string): string {
  return content.length > MAX_INTERPRETATION_EXCERPT_CHARS
    ? `${content.slice(0, MAX_INTERPRETATION_EXCERPT_CHARS).trimEnd()}\n[…truncated by Numa]`
    : content;
}

export function buildInterpretationInput(args: BuildInputArgs): InterpretationInput {
  return {
    protocol: args.protocol,
    source: args.source,
    excerpt: boundExcerpt(args.content),
    exposure: {
      ...args.exposure,
      evidence: [...args.exposure.evidence].sort(),
      knownFacts: [...args.exposure.knownFacts],
    },
    nowIso: new Date(args.now).toISOString(),
    versions: { prompt: PROMPT_VERSION, schema: INTERPRETATION_SCHEMA_VERSION },
  };
}

/** Identity of what was sent (excluding the clock), for audit and dedupe. */
export function interpretationInputHash(input: InterpretationInput): string {
  const stable: Omit<InterpretationInput, "nowIso"> & { nowIso?: string } = { ...input };
  delete stable.nowIso;
  return contentHash(stable);
}
