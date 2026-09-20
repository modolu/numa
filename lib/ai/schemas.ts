/**
 * Strict Structured Outputs schema for interpretation (§8). Every property
 * is required and `additionalProperties` is false, as strict mode demands.
 * Bump SCHEMA_VERSION when the shape changes: it is part of the
 * interpretation identity so old results are never confused with new ones.
 */
import { ProviderError } from "../providers/errors";
import { EVENT_SEVERITIES } from "../validation/events";
import {
  INTERPRETED_CATEGORIES,
  INTERPRETED_EVENT_TYPES,
  type InterpretationOutput,
} from "./provider";

export const INTERPRETATION_SCHEMA_VERSION = "1";
export const INTERPRETATION_SCHEMA_NAME = "numa_source_interpretation";

export const INTERPRETATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "relevant",
    "confidence",
    "eventType",
    "category",
    "headline",
    "summary",
    "whyItMatters",
    "recommendedAction",
    "requiresAction",
    "deadline",
    "deadlineEvidence",
    "claimedSeverity",
    "evidence",
    "unsupportedClaims",
    "relevanceReason",
  ],
  properties: {
    relevant: {
      type: "boolean",
      description: "Whether the change matters to a wallet with the supplied exposure.",
    },
    confidence: { type: "number", description: "0 to 1." },
    eventType: { type: "string", enum: [...INTERPRETED_EVENT_TYPES] },
    category: { type: "string", enum: [...INTERPRETED_CATEGORIES] },
    headline: { type: "string", description: "Plain, factual, under 100 characters." },
    summary: { type: "string", description: "What changed, grounded only in the source text." },
    whyItMatters: {
      type: "string",
      description: "Why it matters given ONLY the supplied exposure facts.",
    },
    recommendedAction: { type: ["string", "null"] },
    requiresAction: { type: "boolean" },
    deadline: {
      type: ["string", "null"],
      description:
        "ISO 8601 with explicit UTC offset, only if the source text states an explicit date/time; otherwise null.",
    },
    deadlineEvidence: {
      type: ["string", "null"],
      description: "Verbatim quote from the source text that states the deadline, or null.",
    },
    claimedSeverity: { type: "string", enum: [...EVENT_SEVERITIES] },
    evidence: {
      type: "array",
      items: { type: "string" },
      description: "Verbatim quotes from the source text that support the summary.",
    },
    unsupportedClaims: {
      type: "array",
      items: { type: "string" },
      description: "Claims you could not ground in the source or exposure facts.",
    },
    relevanceReason: { type: "string" },
  },
} as const;

const KEYS = INTERPRETATION_JSON_SCHEMA.required;

function fail(detail: string): never {
  throw new ProviderError(`Interpretation output malformed: ${detail}`, "malformed", "openai");
}

/** Shape check of a parsed JSON value. Semantic validation lives in validation.ts. */
export function parseInterpretationOutput(value: unknown): InterpretationOutput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("not an object");
  const r = value as Record<string, unknown>;
  for (const key of KEYS) if (!(key in r)) fail(`missing ${key}`);
  for (const key of Object.keys(r)) if (!(KEYS as readonly string[]).includes(key)) fail(`unexpected ${key}`);

  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : fail(`${k} not a string`));
  const strOrNull = (k: string) =>
    r[k] === null ? null : typeof r[k] === "string" ? (r[k] as string) : fail(`${k} not string|null`);
  const bool = (k: string) => (typeof r[k] === "boolean" ? (r[k] as boolean) : fail(`${k} not a boolean`));
  const strArray = (k: string) =>
    Array.isArray(r[k]) && (r[k] as unknown[]).every((x) => typeof x === "string")
      ? (r[k] as string[])
      : fail(`${k} not string[]`);

  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? r.confidence : fail("confidence");
  const eventType = str("eventType");
  if (!(INTERPRETED_EVENT_TYPES as readonly string[]).includes(eventType)) fail(`eventType ${eventType}`);
  const category = str("category");
  if (!(INTERPRETED_CATEGORIES as readonly string[]).includes(category)) fail(`category ${category}`);
  const claimedSeverity = str("claimedSeverity");
  if (!(EVENT_SEVERITIES as readonly string[]).includes(claimedSeverity)) fail(`claimedSeverity ${claimedSeverity}`);

  return {
    relevant: bool("relevant"),
    confidence,
    eventType: eventType as InterpretationOutput["eventType"],
    category: category as InterpretationOutput["category"],
    headline: str("headline"),
    summary: str("summary"),
    whyItMatters: str("whyItMatters"),
    recommendedAction: strOrNull("recommendedAction"),
    requiresAction: bool("requiresAction"),
    deadline: strOrNull("deadline"),
    deadlineEvidence: strOrNull("deadlineEvidence"),
    claimedSeverity: claimedSeverity as InterpretationOutput["claimedSeverity"],
    evidence: strArray("evidence"),
    unsupportedClaims: strArray("unsupportedClaims"),
    relevanceReason: str("relevanceReason"),
  };
}
