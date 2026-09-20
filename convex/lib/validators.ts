/**
 * Convex validators derived from the shared Numa vocabulary in
 * `lib/validation/events.ts`, so the schema, function args and the
 * TypeScript domain types all come from one list.
 */
import { v, type VLiteral, type VUnion } from "convex/values";
import {
  CHAIN_FAMILIES,
  EVENT_CATEGORIES,
  EVENT_SEVERITIES,
  EVENT_STATUSES,
  EVENT_TYPES,
  SOURCE_TYPES,
} from "../../lib/validation/events";
import { PROTOCOL_SOURCE_TYPES } from "../../lib/events/raw";
import { CRAWL_POLICIES } from "../../lib/web/crawlPolicy";

type LiteralUnion<T extends string> = VUnion<
  T,
  VLiteral<T, "required">[],
  "required",
  never
>;

function literalUnion<const T extends readonly string[]>(
  values: T,
): LiteralUnion<T[number]> {
  const members = values.map((value) => v.literal(value)) as VLiteral<
    T[number],
    "required"
  >[];
  return v.union(...members) as unknown as LiteralUnion<T[number]>;
}

export const eventCategoryValidator = literalUnion(EVENT_CATEGORIES);
export const eventSeverityValidator = literalUnion(EVENT_SEVERITIES);
export const eventStatusValidator = literalUnion(EVENT_STATUSES);
export const eventTypeValidator = literalUnion(EVENT_TYPES);
export const sourceTypeValidator = literalUnion(SOURCE_TYPES);
export const chainFamilyValidator = literalUnion(CHAIN_FAMILIES);
export const protocolSourceTypeValidator = literalUnion(PROTOCOL_SOURCE_TYPES);
export const crawlPolicyValidator = literalUnion(CRAWL_POLICIES);

/** Nested provenance object as used by the canonical NumaEvent contract. */
export const eventSourceValidator = v.object({
  type: sourceTypeValidator,
  url: v.optional(v.string()),
  ref: v.optional(v.string()),
});

/**
 * Validator for a canonical NumaEvent (lib/validation/events.ts) as passed
 * into `upsertNormalizedEvent`. Mirrors the TypeScript type field-for-field.
 */
export const numaEventValidator = v.object({
  dedupeKey: v.string(),
  userId: v.id("users"),
  walletId: v.optional(v.id("wallets")),
  protocolId: v.optional(v.id("protocols")),
  chainId: v.optional(v.number()),
  eventType: eventTypeValidator,
  category: eventCategoryValidator,
  severity: eventSeverityValidator,
  title: v.string(),
  summary: v.string(),
  whyItMatters: v.string(),
  recommendedAction: v.optional(v.string()),
  actionUrl: v.optional(v.string()),
  deadline: v.optional(v.number()),
  occurredAt: v.optional(v.number()),
  requiresAction: v.boolean(),
  source: eventSourceValidator,
  confidence: v.number(),
  priorityScore: v.number(),
  isDemo: v.boolean(),
  metadata: v.record(v.string(), v.any()),
});
