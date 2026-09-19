/**
 * Deterministic dedupe keys (NUMA_ARCHITECTURE.md §19).
 *
 *   user + wallet + event type + protocol + external event/version id
 *
 * The key is a readable composite rather than a hash so it stays inspectable
 * in the dashboard; uniqueness is enforced per user through the
 * `by_user_and_dedupe_key` index.
 *
 * For changing metrics (position risk) the external id is a *risk bucket*
 * instead of the raw value, so small metric moves update the existing inbox
 * item and only a bucket change produces a new one.
 */
import type { EventType } from "../../lib/validation/events";

export type DedupeKeyInput = {
  userId: string;
  walletAddress: string | null;
  eventType: EventType;
  protocolSlug: string | null;
  externalId: string;
};

const SEPARATOR = "|";

function part(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return value.replaceAll(SEPARATOR, "_");
}

export function buildDedupeKey(input: DedupeKeyInput): string {
  return [
    part(input.userId),
    part(input.walletAddress?.toLowerCase()),
    part(input.eventType),
    part(input.protocolSlug),
    part(input.externalId),
  ].join(SEPARATOR);
}

/**
 * Health-factor risk buckets for lending positions. Ordered from safest to
 * most dangerous; a lower health factor is riskier.
 */
export const RISK_BUCKETS = [
  "healthy",
  "watch",
  "warning",
  "danger",
  "critical",
] as const;
export type RiskBucket = (typeof RISK_BUCKETS)[number];

export function riskBucketForHealthFactor(healthFactor: number): RiskBucket {
  if (!Number.isFinite(healthFactor) || healthFactor < 1.05) return "critical";
  if (healthFactor < 1.2) return "danger";
  if (healthFactor < 1.5) return "warning";
  if (healthFactor < 2.0) return "watch";
  return "healthy";
}

/** External id for a position-risk event: `hf:<bucket>` (§19 example). */
export function positionRiskExternalId(bucket: RiskBucket): string {
  return `hf:${bucket}`;
}
