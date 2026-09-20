/**
 * Provider-neutral interpretation boundary (NUMA_ARCHITECTURE.md §17, §18).
 *
 * The model receives only the compact, structured `InterpretationInput`
 * Numa builds — never a whole page, never the database, never tools — and
 * must answer with the strict `InterpretationOutput` schema. The rest of
 * Numa depends on these two types only, not on any vendor response shape.
 */
import type { EventCategory, EventSeverity } from "../validation/events";
import type { ProtocolSourceType } from "../events/raw";

/** Event types the model may classify into. Anything else is rejected. */
export const INTERPRETED_EVENT_TYPES = [
  "protocol_update",
  "protocol_migration",
  "governance_deadline",
  "reward_deadline",
  "security_notice",
] as const;
export type InterpretedEventType = (typeof INTERPRETED_EVENT_TYPES)[number];

export const INTERPRETED_CATEGORIES = [
  "update",
  "governance",
  "deadline",
  "security",
  "warning",
  "action",
  "opportunity",
] as const satisfies readonly EventCategory[];

export type ExposureContext = {
  protocolSlug: string;
  protocolName: string;
  /** "live" = backed by onchain observation; "demo" = fixture only. */
  origin: "live" | "demo";
  /** Event types that established the exposure (e.g. "ens_expiry"). */
  evidence: string[];
  /** Deterministic facts Numa already knows for this wallet + protocol. */
  knownFacts: string[];
};

export type InterpretationInput = {
  protocol: { slug: string; name: string };
  source: {
    url: string;
    sourceType: ProtocolSourceType;
    title?: string;
    previousHash: string;
    currentHash: string;
  };
  /** Bounded, normalized changed-source text. Untrusted. */
  excerpt: string;
  exposure: ExposureContext;
  /** ISO timestamp the model may use to resolve relative dates. */
  nowIso: string;
  versions: { prompt: string; schema: string };
};

/** Exactly the strict output schema (lib/ai/schemas.ts), as parsed. */
export type InterpretationOutput = {
  relevant: boolean;
  confidence: number;
  eventType: InterpretedEventType;
  category: (typeof INTERPRETED_CATEGORIES)[number];
  headline: string;
  summary: string;
  whyItMatters: string;
  recommendedAction: string | null;
  requiresAction: boolean;
  /** ISO 8601 with explicit offset, or null when the source is not explicit. */
  deadline: string | null;
  /** Verbatim source quote that states the deadline, or null. */
  deadlineEvidence: string | null;
  claimedSeverity: EventSeverity;
  /** Verbatim source quotes supporting the summary. */
  evidence: string[];
  /** Claims the model wanted to make but could not ground. */
  unsupportedClaims: string[];
  relevanceReason: string;
};

export interface InterpretationProvider {
  readonly provider: string;
  readonly model: string;
  interpret(input: InterpretationInput): Promise<InterpretationOutput>;
}

/** Hard cap on excerpt characters sent to the model. */
export const MAX_INTERPRETATION_EXCERPT_CHARS = 6_000;
