/**
 * Deterministic, inspectable priority engine (NUMA_ARCHITECTURE.md §16).
 *
 *   priority = 0.30 × urgency
 *            + 0.25 × financial exposure
 *            + 0.20 × action requirement
 *            + 0.15 × security impact
 *            + 0.10 × source confidence
 *
 * No LLM involvement: every factor is derived from source/provider data by
 * the normalizer, and the resulting score is stored on the event so the UI
 * and the dashboard can show why an item ranks where it does.
 */
import type { EventSeverity } from "../../lib/validation/events";

export type PriorityFactors = {
  /** Deadline proximity or risk-state urgency, 0..1. */
  urgency: number;
  /** Value at stake for this wallet, 0..1. */
  financialExposure: number;
  /** Does the user need to do something, 0..1. */
  actionRequirement: number;
  /** Loss-of-funds / security relevance, 0..1. */
  securityImpact: number;
  /** Trust in the source, 0..1. */
  sourceConfidence: number;
};

export const PRIORITY_WEIGHTS: Record<keyof PriorityFactors, number> = {
  urgency: 0.3,
  financialExposure: 0.25,
  actionRequirement: 0.2,
  securityImpact: 0.15,
  sourceConfidence: 0.1,
};

export const SEVERITY_THRESHOLDS: ReadonlyArray<[number, EventSeverity]> = [
  [0.85, "critical"],
  [0.7, "high"],
  [0.45, "medium"],
  [0.2, "low"],
];

export type PriorityResult = {
  score: number;
  severity: EventSeverity;
  factors: PriorityFactors;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Round to 4 places so stored scores are stable across re-runs. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function normalizeFactors(factors: PriorityFactors): PriorityFactors {
  return {
    urgency: clamp01(factors.urgency),
    financialExposure: clamp01(factors.financialExposure),
    actionRequirement: clamp01(factors.actionRequirement),
    securityImpact: clamp01(factors.securityImpact),
    sourceConfidence: clamp01(factors.sourceConfidence),
  };
}

export function computePriorityScore(factors: PriorityFactors): number {
  const f = normalizeFactors(factors);
  const score =
    PRIORITY_WEIGHTS.urgency * f.urgency +
    PRIORITY_WEIGHTS.financialExposure * f.financialExposure +
    PRIORITY_WEIGHTS.actionRequirement * f.actionRequirement +
    PRIORITY_WEIGHTS.securityImpact * f.securityImpact +
    PRIORITY_WEIGHTS.sourceConfidence * f.sourceConfidence;
  return round4(clamp01(score));
}

export function severityForScore(score: number): EventSeverity {
  for (const [threshold, severity] of SEVERITY_THRESHOLDS) {
    if (score >= threshold) return severity;
  }
  return "info";
}

export function scorePriority(factors: PriorityFactors): PriorityResult {
  const normalized = normalizeFactors(factors);
  const score = computePriorityScore(normalized);
  return { score, severity: severityForScore(score), factors: normalized };
}

// ---------------------------------------------------------------------------
// Factor helpers used by the normalizer. Kept here so every rule that feeds
// the score is in one inspectable file.
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Deadline proximity → urgency. Past-due counts as maximally urgent. */
export function urgencyForDeadline(deadline: number, now: number): number {
  const remaining = deadline - now;
  if (remaining <= HOUR) return 1;
  if (remaining <= DAY) return 0.9;
  if (remaining <= 3 * DAY) return 0.75;
  if (remaining <= 7 * DAY) return 0.55;
  if (remaining <= 14 * DAY) return 0.3;
  if (remaining <= 30 * DAY) return 0.2;
  return 0.1;
}

/** USD at stake → exposure. Tiers keep the mapping legible. */
export function exposureForUsd(usd: number | undefined): number {
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return 0;
  if (usd < 100) return 0.1;
  if (usd < 1_000) return 0.3;
  if (usd < 10_000) return 0.65;
  if (usd < 100_000) return 0.85;
  return 1;
}
