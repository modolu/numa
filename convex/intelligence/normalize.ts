/**
 * Normalization: raw source observations → canonical NumaEvent candidates
 * (NUMA_ARCHITECTURE.md §10, §11, §20).
 *
 * Pure functions. Every adapter (fixtures today; ENS/Aave/governance/bridge
 * adapters and Firecrawl later) must emit one of the `RawEventPayload`
 * shapes below; this module is the only place that knows how to turn them
 * into inbox copy, provenance and priority factors.
 */
import type { Id } from "../_generated/dataModel";
import type {
  EventCategory,
  EventType,
  NumaEvent,
  NumaEventSource,
} from "../../lib/validation/events";
import type {
  BridgeClaimReadyPayload,
  EnsExpiryPayload,
  GovernanceDeadlinePayload,
  PositionRiskPayload,
  ProtocolMigrationPayload,
  ProtocolUpdatePayload,
  RawEventInput,
} from "../../lib/events/raw";
import {
  buildDedupeKey,
  positionRiskExternalId,
  riskBucketForHealthFactor,
  type RiskBucket,
} from "../lib/dedupe";
import {
  ensExpiryFactors,
  ensExpiryStage,
  exposureForUsd,
  protocolUpdateFactors,
  urgencyForDeadline,
  type PriorityFactors,
} from "./priority";

// ---------------------------------------------------------------------------
// Raw payload contract lives in lib/events/raw.ts (shared with adapters).
// ---------------------------------------------------------------------------

export type {
  BridgeClaimReadyPayload,
  EnsExpiryPayload,
  GovernanceDeadlinePayload,
  PositionRiskPayload,
  ProtocolMigrationPayload,
  ProtocolUpdatePayload,
  RawEventInput,
  RawEventPayload,
} from "../../lib/events/raw";
export { isRawEventPayload } from "../../lib/events/raw";

// ---------------------------------------------------------------------------
// Normalized output
// ---------------------------------------------------------------------------

export type NormalizationContext = {
  userId: Id<"users">;
  walletId: Id<"wallets">;
  walletAddress: string;
  protocolId?: Id<"protocols">;
  /** Display name for the protocol (used in offchain update copy). */
  protocolName?: string;
  /** Whether the user's exposure to this protocol comes from demo data. */
  exposureOrigin?: "live" | "demo";
  now: number;
};

/**
 * Everything the canonical event needs except the priority engine's output.
 * `priorityFactors` are derived from source data here; `scorePriority`
 * turns them into `severity` and `priorityScore`.
 */
export type NormalizedEvent = Omit<NumaEvent, "severity" | "priorityScore"> & {
  priorityFactors: PriorityFactors;
};

const SECURITY_IMPACT: Record<EventType, number> = {
  position_risk: 0.6, // refined per risk bucket below
  token_approval_warning: 0.8,
  protocol_migration: 0.4,
  bridge_claim_ready: 0.2,
  ens_expiry: 0.2, // superseded by ensExpiryFactors (stage-based)
  governance_deadline: 0.1,
  reward_deadline: 0.1,
  protocol_update: 0,
};

const RISK_BUCKET_URGENCY: Record<RiskBucket, number> = {
  critical: 1,
  danger: 0.9,
  warning: 0.7,
  watch: 0.4,
  healthy: 0.1,
};

const RISK_BUCKET_SECURITY: Record<RiskBucket, number> = {
  critical: 1,
  danger: 0.85,
  warning: 0.6,
  watch: 0.3,
  healthy: 0.1,
};

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatHours(ms: number): string {
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

type Shaped = {
  eventType: EventType;
  category: EventCategory;
  externalId: string;
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
  metadata: Record<string, unknown>;
  priorityFactors: PriorityFactors;
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const ENS_RELATIONSHIP_CONFIDENCE: Record<EnsExpiryPayload["relationship"], number> = {
  registrant: 0.95,
  wrapped_owner: 0.95,
  primary_name: 0.8,
};

/**
 * ENS expiry copy is state-based, not time-based: titles use a stage
 * (expired / soon / a date) and absolute dates so a re-scan in the same stage
 * is byte-identical, while the UI formats "in 12 days" from `deadline` live.
 */
function shapeEnsExpiry(p: EnsExpiryPayload, now: number): Shaped {
  const stage = ensExpiryStage(p.expiresAt, now);
  const expired = stage === "expired";
  const soon = stage === "imminent" || stage === "week" || stage === "month";
  const expiryDate = formatDate(p.expiresAt);
  const confidence = ENS_RELATIONSHIP_CONFIDENCE[p.relationship];

  const title = expired
    ? `${p.name} has expired`
    : soon
      ? `${p.name} expires soon`
      : `${p.name} expires on ${expiryDate}`;

  const holding =
    p.relationship === "primary_name"
      ? `This wallet uses ${p.name} as its primary name; the registration is held by another address.`
      : `This wallet holds the registration${p.relationship === "wrapped_owner" ? " (wrapped)" : ""}.`;

  const summary = expired
    ? `The registration for ${p.name} lapsed on ${expiryDate}${
        p.gracePeriodEndsAt !== undefined
          ? ` and can still be renewed until ${formatDate(p.gracePeriodEndsAt)}`
          : ""
      }. ${holding}`
    : `Your ENS name ${p.name} is registered until ${expiryDate}. ${holding}`;

  return {
    eventType: "ens_expiry",
    category: "deadline",
    externalId: p.name,
    title,
    summary,
    whyItMatters:
      "If the registration expires and passes the grace period, the name is released and anyone can register it — anything that resolves to it stops pointing at you.",
    recommendedAction: "Review and renew the registration",
    actionUrl: p.renewUrl,
    deadline: p.expiresAt,
    requiresAction: true,
    source: {
      type: "onchain",
      url: p.renewUrl,
      ref: p.tokenId !== undefined ? `${p.registrarContract ?? "registrar"}#${p.tokenId}` : p.registrarContract,
    },
    confidence,
    metadata: {
      name: p.name,
      currentValue: new Date(p.expiresAt).toISOString(),
      expiresAt: p.expiresAt,
      gracePeriodEndsAt: p.gracePeriodEndsAt,
      expiryStage: stage,
      relationship: p.relationship,
      registrant: p.registrant,
      tokenId: p.tokenId,
      // observedBlock stays on the raw observation only: it changes every
      // scan and would defeat the "unchanged" fingerprint.
      relatedContract: p.registrarContract,
      officialActionUrl: p.renewUrl,
    },
    priorityFactors: ensExpiryFactors(p.expiresAt, now, confidence),
  };
}

function shapePositionRisk(p: PositionRiskPayload): Shaped {
  const bucket = riskBucketForHealthFactor(p.healthFactor);
  const hf = p.healthFactor.toFixed(2);
  const prev = p.previousHealthFactor?.toFixed(2);
  const trend =
    p.previousHealthFactor !== undefined
      ? p.previousHealthFactor > p.healthFactor
        ? `dropped from ${prev} to ${hf}`
        : `moved from ${prev} to ${hf}`
      : `is ${hf}`;
  const exposureUsd = p.collateralUsd;
  return {
    eventType: "position_risk",
    category: bucket === "critical" || bucket === "danger" ? "security" : "warning",
    externalId: positionRiskExternalId(bucket),
    title: `${p.market} health factor is ${hf}`,
    summary: `Your ${p.collateralAsset} collateral / ${p.debtAsset} borrow position on ${p.market} ${trend}.`,
    whyItMatters: `Below 1.00 the position can be liquidated. ${formatUsd(
      p.collateralUsd,
    )} of collateral backs ${formatUsd(p.debtUsd)} of debt.`,
    recommendedAction: "Review collateral or debt",
    actionUrl: p.positionUrl,
    requiresAction: true,
    source: { type: "onchain", url: p.positionUrl, ref: p.poolContract },
    confidence: 0.95,
    metadata: {
      riskBucket: bucket,
      previousValue: p.previousHealthFactor,
      currentValue: p.healthFactor,
      exposureUsd,
      collateralUsd: p.collateralUsd,
      debtUsd: p.debtUsd,
      collateralAsset: p.collateralAsset,
      debtAsset: p.debtAsset,
      relatedContract: p.poolContract,
      officialActionUrl: p.positionUrl,
    },
    priorityFactors: {
      urgency: RISK_BUCKET_URGENCY[bucket],
      financialExposure: exposureForUsd(exposureUsd),
      actionRequirement: 1,
      securityImpact: RISK_BUCKET_SECURITY[bucket],
      sourceConfidence: 0.95,
    },
  };
}

function shapeGovernanceDeadline(
  p: GovernanceDeadlinePayload,
  now: number,
): Shaped {
  const remaining = p.votingEndsAt - now;
  return {
    eventType: "governance_deadline",
    category: "governance",
    externalId: p.proposalId,
    title:
      remaining > 0
        ? `${p.daoName} proposal closes in ${formatHours(remaining)}`
        : `${p.daoName} proposal voting has closed`,
    summary: `${p.proposalTitle} is open for voting and this wallet holds ${p.votingPower.toLocaleString(
      "en-US",
    )} ${p.votingPowerSymbol} of voting power.`,
    whyItMatters:
      "Your voting power only counts if the vote is cast before the deadline; unused votes forfeit your say in the outcome.",
    recommendedAction: "Review and vote",
    actionUrl: p.voteUrl,
    deadline: p.votingEndsAt,
    requiresAction: true,
    source: { type: "governance", url: p.sourceUrl, ref: p.proposalId },
    confidence: 0.95,
    metadata: {
      daoName: p.daoName,
      proposalId: p.proposalId,
      proposalTitle: p.proposalTitle,
      votingPower: p.votingPower,
      votingPowerSymbol: p.votingPowerSymbol,
      officialActionUrl: p.voteUrl,
    },
    priorityFactors: {
      urgency: urgencyForDeadline(p.votingEndsAt, now),
      financialExposure: 0.2,
      actionRequirement: 1,
      securityImpact: SECURITY_IMPACT.governance_deadline,
      sourceConfidence: 0.95,
    },
  };
}

function shapeBridgeClaimReady(p: BridgeClaimReadyPayload): Shaped {
  const usd = p.amountUsd !== undefined ? ` (${formatUsd(p.amountUsd)})` : "";
  return {
    eventType: "bridge_claim_ready",
    category: "action",
    externalId: p.withdrawalTxHash,
    title: `${p.amount} ${p.asset} is ready to claim`,
    summary: `A bridge withdrawal of ${p.amount} ${p.asset}${usd} has finished its challenge period and is waiting for you to claim it.`,
    whyItMatters:
      "The funds stay locked in the bridge contract until you execute the claim; nothing happens automatically.",
    recommendedAction: "Claim withdrawal",
    actionUrl: p.claimUrl,
    occurredAt: p.readySince,
    requiresAction: true,
    source: { type: "onchain", url: p.claimUrl, ref: p.withdrawalTxHash },
    confidence: 0.98,
    metadata: {
      amount: p.amount,
      asset: p.asset,
      exposureUsd: p.amountUsd,
      relatedTransaction: p.withdrawalTxHash,
      officialActionUrl: p.claimUrl,
    },
    priorityFactors: {
      urgency: 0.5,
      financialExposure: exposureForUsd(p.amountUsd),
      actionRequirement: 1,
      securityImpact: SECURITY_IMPACT.bridge_claim_ready,
      sourceConfidence: 0.98,
    },
  };
}

function shapeProtocolMigration(
  p: ProtocolMigrationPayload,
  now: number,
): Shaped {
  return {
    eventType: "protocol_migration",
    category: "update",
    externalId: p.announcementId,
    title: p.headline,
    summary: p.details,
    whyItMatters: `This wallet has ${formatUsd(
      p.exposureUsd,
    )} exposed to the affected market, so the change applies to you.`,
    recommendedAction: "Review migration steps",
    actionUrl: p.migrationUrl,
    deadline: p.migrateBy,
    requiresAction: true,
    source: { type: "official_web", url: p.sourceUrl, ref: p.announcementId },
    confidence: 0.9,
    metadata: {
      announcementId: p.announcementId,
      exposureUsd: p.exposureUsd,
      officialActionUrl: p.migrationUrl,
    },
    priorityFactors: {
      urgency:
        p.migrateBy !== undefined ? urgencyForDeadline(p.migrateBy, now) : 0.2,
      financialExposure: exposureForUsd(p.exposureUsd),
      actionRequirement: 1,
      securityImpact: SECURITY_IMPACT.protocol_migration,
      sourceConfidence: 0.9,
    },
  };
}

const SOURCE_TYPE_NOUN: Record<ProtocolUpdatePayload["sourceType"], string> = {
  docs: "documentation",
  blog: "blog",
  governance: "governance",
  changelog: "changelog",
  status: "status",
  announcement: "announcements",
};

/**
 * Deterministic, semantically neutral copy for a changed official page. It
 * states that a monitored source changed and where — never what the change
 * means or what the user must do, because nothing here has interpreted the
 * content (§17/§18 guardrails).
 */
function shapeProtocolUpdate(
  p: ProtocolUpdatePayload,
  context: NormalizationContext,
  observedAt: number,
): Shaped {
  const protocolName = context.protocolName ?? p.protocol;
  const noun = SOURCE_TYPE_NOUN[p.sourceType] ?? p.sourceType;
  const exposure =
    context.exposureOrigin === "demo"
      ? `Your demo inbox includes ${protocolName} exposure, so Numa is monitoring its official updates.`
      : `You interact with ${protocolName}, so Numa is monitoring its official updates.`;
  return {
    eventType: "protocol_update",
    category: "update",
    externalId: `${p.sourceId}:${p.currentHash}`,
    title: `${protocolName} official ${noun} source updated`,
    summary: `An official monitored ${noun} page changed${p.title ? ` (“${p.title}”)` : ""}. Numa has not interpreted the change yet.`,
    whyItMatters: exposure,
    recommendedAction: "Review the source update",
    actionUrl: p.sourceUrl,
    occurredAt: observedAt,
    requiresAction: false,
    source: { type: "official_web", url: p.sourceUrl, ref: `${p.sourceId}#${p.currentHash.slice(0, 12)}` },
    confidence: 0.95,
    metadata: {
      sourceId: p.sourceId,
      sourceType: p.sourceType,
      pageTitle: p.title,
      previousHash: p.previousHash,
      currentHash: p.currentHash,
      excerpt: p.excerpt,
      contentLength: p.contentLength,
      exposureOrigin: context.exposureOrigin ?? "live",
      interpreted: false,
    },
    priorityFactors: protocolUpdateFactors(),
  };
}

function shape(
  raw: RawEventInput,
  now: number,
  context: NormalizationContext,
): Shaped {
  const payload = raw.payload;
  switch (payload.kind) {
    case "protocol_update":
      return shapeProtocolUpdate(payload, context, raw.observedAt);
    case "ens_expiry":
      return shapeEnsExpiry(payload, now);
    case "position_risk":
      return shapePositionRisk(payload);
    case "governance_deadline":
      return shapeGovernanceDeadline(payload, now);
    case "bridge_claim_ready":
      return shapeBridgeClaimReady(payload);
    case "protocol_migration":
      return shapeProtocolMigration(payload, now);
  }
}

function stripUndefined(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Turn a raw observation into a normalized event candidate for one user
 * and wallet. Throws when the payload shape is unknown.
 */
export function normalizeRawEvent(
  raw: RawEventInput,
  context: NormalizationContext,
): NormalizedEvent {
  const shaped = shape(raw, context.now, context);
  const dedupeKey = buildDedupeKey({
    userId: context.userId,
    walletAddress: context.walletAddress,
    eventType: shaped.eventType,
    protocolSlug: raw.payload.protocol,
    externalId: shaped.externalId,
  });
  return {
    dedupeKey,
    userId: context.userId,
    walletId: context.walletId,
    protocolId: context.protocolId,
    chainId: raw.payload.chainId,
    eventType: shaped.eventType,
    category: shaped.category,
    title: shaped.title,
    summary: shaped.summary,
    whyItMatters: shaped.whyItMatters,
    recommendedAction: shaped.recommendedAction,
    actionUrl: shaped.actionUrl,
    deadline: shaped.deadline,
    occurredAt: shaped.occurredAt,
    requiresAction: shaped.requiresAction,
    source: shaped.source,
    confidence: shaped.confidence,
    isDemo: raw.isDemo,
    metadata: stripUndefined({
      ...shaped.metadata,
      protocol: raw.payload.protocol,
      rawSource: raw.source,
      rawSourceEventId: raw.sourceEventId,
    }),
    priorityFactors: shaped.priorityFactors,
  };
}
