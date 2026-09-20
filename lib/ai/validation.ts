/**
 * Local validation of model output (§8, §11, §12, §13, §21). Schema-valid is
 * necessary, not sufficient: every claim must be grounded in the source
 * excerpt or the exposure facts, text is sanitized and bounded, deadlines
 * must be explicit and quoted, and the final severity is produced by the
 * deterministic priority engine with a hard cap unless corroborated.
 */
import type { EventSeverity } from "../validation/events";
import {
  computePriorityScore,
  severityForScore,
  urgencyForDeadline,
  type PriorityFactors,
} from "../../convex/intelligence/priority";
import {
  INTERPRETED_CATEGORIES,
  INTERPRETED_EVENT_TYPES,
  type InterpretationInput,
  type InterpretationOutput,
  type InterpretedEventType,
} from "./provider";

export const LIMITS = {
  headline: 120,
  summary: 500,
  whyItMatters: 500,
  recommendedAction: 160,
  relevanceReason: 300,
  evidenceQuote: 400,
  maxEvidence: 6,
  minEvidenceChars: 12,
} as const;

/** Claims that need deterministic wallet/provider data Numa does not have yet. */
export const FORBIDDEN_CLAIMS: readonly RegExp[] = [
  /\bfunds?\s+(are|is|will be|may be|could be)\s+(at\s+)?risk/i,
  /\byou\s+(are|'re)\s+eligible\b/i,
  /\b(position|collateral|loan)s?\s+(will|would|may|could)\s+be\s+liquidated/i,
  /\byou\s+(must|need to|have to|should)\s+migrate\b/i,
  /\bsend\s+(your\s+)?(funds|eth|tokens|money)\b/i,
  /\b(seed\s+phrase|private\s+key|recovery\s+phrase)\b/i,
  /\bignore\s+(all\s+|the\s+)?(previous|prior|above)\s+instructions\b/i,
  /\bsystem\s+prompt\b/i,
];

const KEY_SHAPED = /\b(sk|fc|pk|rk)-[A-Za-z0-9_-]{10,}\b|\b0x[a-fA-F0-9]{64}\b/;
const URL = /[a-z][a-z0-9+.-]*:\/\/\S+|\bwww\.\S+/gi;
const TAG = /<[^>]{1,200}>/g;
const MD_LINK = /\[([^\]]{0,200})\]\([^)]{0,500}\)/g;
const MD_MARKS = /[*_`#>]+/g;

export type ValidationFailure = { ok: false; reason: string; details: string[] };
export type ValidatedInterpretation = {
  relevant: boolean;
  confidence: number;
  eventType: InterpretedEventType;
  category: InterpretationOutput["category"];
  headline: string;
  summary: string;
  whyItMatters: string;
  recommendedAction: string | null;
  requiresAction: boolean;
  deadline: number | null;
  deadlineEvidence: string | null;
  claimedSeverity: EventSeverity;
  evidence: string[];
  unsupportedClaims: string[];
  relevanceReason: string;
  /** Deterministic corroboration available for high/critical severity. */
  corroboration: { explicitDeadline: boolean };
  severityCapped: boolean;
  priorityFactors: PriorityFactors;
  priorityScore: number;
  severity: EventSeverity;
  notes: string[];
};
export type ValidationResult = { ok: true; value: ValidatedInterpretation } | ValidationFailure;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function sanitizeText(value: string, max: number): string {
  return value
    .replace(TAG, " ")
    .replace(MD_LINK, "$1")
    .replace(URL, "")
    .replace(MD_MARKS, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** A quote is grounded when it appears verbatim (whitespace/case-insensitive) in the excerpt. */
export function isGroundedQuote(quote: string, excerpt: string): boolean {
  const q = squash(quote);
  if (q.length < LIMITS.minEvidenceChars) return false;
  return squash(excerpt).includes(q);
}

export function containsForbiddenClaim(text: string): RegExp | null {
  for (const pattern of FORBIDDEN_CLAIMS) if (pattern.test(text)) return pattern;
  return null;
}

// ---------------------------------------------------------------------------
// Deadline
// ---------------------------------------------------------------------------

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DAY = 24 * 3_600_000;
const MIN_PAST_MS = 30 * DAY;
const MAX_FUTURE_MS = 2 * 365 * DAY;

export type DeadlineCheck = { deadline: number | null; evidence: string | null; note?: string };

export function validateDeadline(
  deadline: string | null,
  deadlineEvidence: string | null,
  excerpt: string,
  now: number,
): DeadlineCheck {
  if (deadline === null) return { deadline: null, evidence: null };
  if (!ISO_WITH_OFFSET.test(deadline)) {
    return { deadline: null, evidence: null, note: "deadline rejected: not ISO 8601 with explicit offset" };
  }
  const ms = Date.parse(deadline);
  if (!Number.isFinite(ms)) return { deadline: null, evidence: null, note: "deadline rejected: unparseable" };
  if (ms < now - MIN_PAST_MS || ms > now + MAX_FUTURE_MS) {
    return { deadline: null, evidence: null, note: "deadline rejected: outside plausible range" };
  }
  if (!deadlineEvidence || !isGroundedQuote(deadlineEvidence, excerpt) || !/\d/.test(deadlineEvidence)) {
    return { deadline: null, evidence: null, note: "deadline rejected: no grounded source quote" };
  }
  return { deadline: ms, evidence: sanitizeText(deadlineEvidence, LIMITS.evidenceQuote) };
}

// ---------------------------------------------------------------------------
// Severity guardrail
// ---------------------------------------------------------------------------

const CLAIMED_URGENCY: Record<EventSeverity, number> = { critical: 0.7, high: 0.55, medium: 0.35, low: 0.15, info: 0.05 };
const CLAIMED_SECURITY: Record<EventSeverity, number> = { critical: 0.5, high: 0.35, medium: 0.2, low: 0.1, info: 0 };

/**
 * Highest severity allowed without deterministic corroboration. Today the
 * only corroboration Numa can verify is an explicit, quoted source deadline;
 * live wallet facts (health factors, balances) join in a later milestone.
 * Without it an interpreted event can never rank above `low`, whatever the
 * model claims — the deadline's own urgency then decides high/critical.
 */
export const UNCORROBORATED_SEVERITY_CAP: EventSeverity = "low";
const CAP_SCORE = 0.4499;
const SEVERITY_ORDER: EventSeverity[] = ["info", "low", "medium", "high", "critical"];

export function interpretedPriorityFactors(
  v: Pick<ValidatedInterpretation, "claimedSeverity" | "requiresAction" | "deadline" | "eventType" | "confidence">,
  exposureOrigin: "live" | "demo",
  now: number,
): PriorityFactors {
  return {
    urgency: v.deadline !== null ? urgencyForDeadline(v.deadline, now) : CLAIMED_URGENCY[v.claimedSeverity],
    // Balances are unknown: only a token exposure signal, weaker for demo data.
    financialExposure: exposureOrigin === "live" ? 0.3 : 0.1,
    actionRequirement: v.requiresAction ? 1 : 0.1,
    securityImpact: v.eventType === "security_notice" ? Math.max(0.4, CLAIMED_SECURITY[v.claimedSeverity]) : CLAIMED_SECURITY[v.claimedSeverity],
    sourceConfidence: Math.min(0.95, Math.max(0, v.confidence)),
  };
}

// ---------------------------------------------------------------------------
// Main validation
// ---------------------------------------------------------------------------

export function validateInterpretation(
  output: InterpretationOutput,
  input: InterpretationInput,
  now: number,
): ValidationResult {
  const details: string[] = [];
  const notes: string[] = [];

  if (!(INTERPRETED_EVENT_TYPES as readonly string[]).includes(output.eventType)) {
    return { ok: false, reason: "unsupported_event_type", details: [output.eventType] };
  }
  if (!(INTERPRETED_CATEGORIES as readonly string[]).includes(output.category)) {
    return { ok: false, reason: "unsupported_category", details: [output.category] };
  }
  if (!Number.isFinite(output.confidence) || output.confidence < 0 || output.confidence > 1) {
    return { ok: false, reason: "confidence_out_of_bounds", details: [String(output.confidence)] };
  }

  const raw = {
    headline: output.headline,
    summary: output.summary,
    whyItMatters: output.whyItMatters,
    recommendedAction: output.recommendedAction ?? "",
    relevanceReason: output.relevanceReason,
  };
  for (const [field, text] of Object.entries(raw)) {
    if (KEY_SHAPED.test(text)) return { ok: false, reason: "secret_shaped_text", details: [field] };
    const forbidden = containsForbiddenClaim(text);
    if (forbidden) details.push(`${field}: ${forbidden.source}`);
  }
  if (details.length > 0) return { ok: false, reason: "unsupported_claim", details };

  const headline = sanitizeText(raw.headline, LIMITS.headline);
  const summary = sanitizeText(raw.summary, LIMITS.summary);
  const whyItMatters = sanitizeText(raw.whyItMatters, LIMITS.whyItMatters);
  const recommendedAction = output.recommendedAction ? sanitizeText(output.recommendedAction, LIMITS.recommendedAction) || null : null;
  const relevanceReason = sanitizeText(raw.relevanceReason, LIMITS.relevanceReason);
  if (!headline || !summary || !whyItMatters) {
    return { ok: false, reason: "empty_text", details: ["headline/summary/whyItMatters"] };
  }
  if (URL.test(raw.summary + raw.whyItMatters + raw.recommendedAction + raw.headline)) {
    notes.push("urls stripped from model text");
  }

  const evidence = output.evidence
    .filter((q) => isGroundedQuote(q, input.excerpt))
    .map((q) => sanitizeText(q, LIMITS.evidenceQuote))
    .filter((q) => q.length >= LIMITS.minEvidenceChars)
    .slice(0, LIMITS.maxEvidence);
  const droppedEvidence = output.evidence.length - evidence.length;
  if (droppedEvidence > 0) notes.push(`${droppedEvidence} ungrounded evidence quote(s) dropped`);
  if (output.relevant && evidence.length === 0) {
    return { ok: false, reason: "ungrounded", details: ["relevant=true without any grounded evidence quote"] };
  }

  const deadlineCheck = validateDeadline(output.deadline, output.deadlineEvidence, input.excerpt, now);
  if (deadlineCheck.note) notes.push(deadlineCheck.note);

  let eventType = output.eventType;
  let category = output.category;
  if ((eventType === "governance_deadline" || eventType === "reward_deadline") && deadlineCheck.deadline === null) {
    notes.push(`${eventType} downgraded to protocol_update: no validated deadline`);
    eventType = "protocol_update";
    category = "update";
  }

  const unsupportedClaims = output.unsupportedClaims.map((c) => sanitizeText(c, LIMITS.evidenceQuote)).filter(Boolean).slice(0, 10);

  const base = {
    relevant: output.relevant,
    confidence: Math.round(output.confidence * 100) / 100,
    eventType,
    category,
    headline,
    summary,
    whyItMatters,
    recommendedAction,
    requiresAction: output.requiresAction && output.relevant,
    deadline: deadlineCheck.deadline,
    deadlineEvidence: deadlineCheck.evidence,
    claimedSeverity: output.claimedSeverity,
    evidence,
    unsupportedClaims,
    relevanceReason,
  };

  const priorityFactors = interpretedPriorityFactors(base, input.exposure.origin, now);
  let priorityScore = computePriorityScore(priorityFactors);
  let severity = severityForScore(priorityScore);
  const corroboration = { explicitDeadline: base.deadline !== null };
  let severityCapped = false;
  if (
    !corroboration.explicitDeadline &&
    SEVERITY_ORDER.indexOf(severity) > SEVERITY_ORDER.indexOf(UNCORROBORATED_SEVERITY_CAP)
  ) {
    severityCapped = true;
    priorityScore = Math.min(priorityScore, CAP_SCORE);
    severity = severityForScore(priorityScore);
    notes.push(`severity capped at ${UNCORROBORATED_SEVERITY_CAP}: no deterministic corroboration`);
  }

  return {
    ok: true,
    value: { ...base, corroboration, severityCapped, priorityFactors, priorityScore, severity, notes },
  };
}
