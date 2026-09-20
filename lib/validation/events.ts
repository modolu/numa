/**
 * Canonical Numa event vocabulary and contract.
 *
 * Source of truth: NUMA_ARCHITECTURE.md §4.1, §10, §11.
 * These constants are shared by the Convex backend (validators, pipeline),
 * the frontend (labels, ordering) and the tests. Keep them in one place.
 */
import type { Id } from "../../convex/_generated/dataModel";

export const EVENT_CATEGORIES = [
  "action",
  "warning",
  "deadline",
  "update",
  "opportunity",
  "security",
  "governance",
] as const;

export const EVENT_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;

export const EVENT_STATUSES = [
  "unread",
  "read",
  "snoozed",
  "completed",
  "dismissed",
  "expired",
] as const;

/** MVP event types (§11). Deliberately small. */
export const EVENT_TYPES = [
  "ens_expiry",
  "governance_deadline",
  "bridge_claim_ready",
  "token_approval_warning",
  "protocol_migration",
  "position_risk",
  "reward_deadline",
  // Generic "an official monitored source changed" (offchain, deterministic).
  "protocol_update",
] as const;

/** Provenance families (§10 `source.type`). */
export const SOURCE_TYPES = ["onchain", "official_web", "governance"] as const;

export const CHAIN_FAMILIES = ["evm"] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type EventSeverity = (typeof EVENT_SEVERITIES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type SourceType = (typeof SOURCE_TYPES)[number];
export type ChainFamily = (typeof CHAIN_FAMILIES)[number];

/** Higher rank = more urgent. Used for inbox ordering and UI grouping. */
export const SEVERITY_RANK: Record<EventSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** Terminal statuses never transition anywhere else. */
export const TERMINAL_STATUSES: readonly EventStatus[] = [
  "completed",
  "dismissed",
  "expired",
];

/** Statuses that keep an event in the primary inbox. */
export const ACTIVE_STATUSES: readonly EventStatus[] = ["unread", "read"];

export type NumaEventSource = {
  type: SourceType;
  url?: string;
  ref?: string;
};

/**
 * Canonical Numa event contract (§10, called `ArcEvent` in the architecture
 * doc; `NumaEvent` is the TypeScript domain name). Every source — fixture,
 * onchain adapter, crawled page — must be normalized into this shape before
 * it can reach the inbox.
 *
 * `priorityScore` and `isDemo` are additive to §10: the score keeps the
 * priority engine inspectable (§16) and `isDemo` lets the UI label fixture
 * data (§34).
 */
export type NumaEvent = {
  dedupeKey: string;

  userId: Id<"users">;
  walletId?: Id<"wallets">;

  protocolId?: Id<"protocols">;
  chainId?: number;

  eventType: EventType;
  category: EventCategory;
  severity: EventSeverity;

  title: string;
  summary: string;
  whyItMatters: string;

  recommendedAction?: string;
  actionUrl?: string;

  deadline?: number;
  occurredAt?: number;

  requiresAction: boolean;

  source: NumaEventSource;

  confidence: number;
  priorityScore: number;

  isDemo: boolean;
  metadata: Record<string, unknown>;
};

export function isEventCategory(value: unknown): value is EventCategory {
  return (EVENT_CATEGORIES as readonly unknown[]).includes(value);
}

export function isEventSeverity(value: unknown): value is EventSeverity {
  return (EVENT_SEVERITIES as readonly unknown[]).includes(value);
}

export function isEventStatus(value: unknown): value is EventStatus {
  return (EVENT_STATUSES as readonly unknown[]).includes(value);
}

export function isEventType(value: unknown): value is EventType {
  return (EVENT_TYPES as readonly unknown[]).includes(value);
}
