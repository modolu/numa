/**
 * Raw observation contract — what every source adapter produces and the only
 * shape the normalizer accepts (NUMA_ARCHITECTURE.md §12).
 *
 * Adapters (fixtures, the ENS adapter, later Aave/governance/bridge and
 * Firecrawl) map vendor responses into these payloads so normalization never
 * depends on a third-party response format.
 */

type BasePayload = {
  /** The wallet this observation is about (lowercased EVM address). */
  wallet: string;
  /** Protocol slug (matches `protocols.slug`). */
  protocol: string;
  chainId: number;
};

/** How the monitored wallet relates to an ENS name. */
export type EnsRelationship =
  /** Wallet holds the .eth registration NFT on the BaseRegistrar. */
  | "registrant"
  /** Registration is wrapped; wallet owns it in the NameWrapper. */
  | "wrapped_owner"
  /** Wallet's reverse record points at the name but another address holds it. */
  | "primary_name";

export type EnsExpiryPayload = BasePayload & {
  kind: "ens_expiry";
  name: string;
  /** Registration expiry, ms since epoch. */
  expiresAt: number;
  /** End of the .eth grace period (expiry + 90 days), ms since epoch. */
  gracePeriodEndsAt?: number;
  relationship: EnsRelationship;
  /** Address holding the registration when it is not the wallet. */
  registrant?: string;
  /** BaseRegistrar token id (decimal string). */
  tokenId?: string;
  renewUrl: string;
  registrarContract?: string;
  /** Block the state was read at, for auditability. */
  observedBlock?: number;
};

export type PositionRiskPayload = BasePayload & {
  kind: "position_risk";
  market: string;
  healthFactor: number;
  previousHealthFactor?: number;
  collateralUsd: number;
  debtUsd: number;
  collateralAsset: string;
  debtAsset: string;
  positionUrl: string;
  poolContract?: string;
};

export type GovernanceDeadlinePayload = BasePayload & {
  kind: "governance_deadline";
  daoName: string;
  proposalId: string;
  proposalTitle: string;
  votingEndsAt: number;
  votingPower: number;
  votingPowerSymbol: string;
  voteUrl: string;
  sourceUrl: string;
};

export type BridgeClaimReadyPayload = BasePayload & {
  kind: "bridge_claim_ready";
  amount: number;
  asset: string;
  amountUsd?: number;
  withdrawalTxHash: string;
  readySince: number;
  claimUrl: string;
};

export type ProtocolMigrationPayload = BasePayload & {
  kind: "protocol_migration";
  announcementId: string;
  headline: string;
  details: string;
  sourceUrl: string;
  migrateBy?: number;
  exposureUsd: number;
  migrationUrl: string;
};

export type RawEventPayload =
  | EnsExpiryPayload
  | PositionRiskPayload
  | GovernanceDeadlinePayload
  | BridgeClaimReadyPayload
  | ProtocolMigrationPayload;

export const RAW_PAYLOAD_KINDS: readonly RawEventPayload["kind"][] = [
  "ens_expiry",
  "position_risk",
  "governance_deadline",
  "bridge_claim_ready",
  "protocol_migration",
];

export type RawEventInput = {
  source: string;
  sourceEventId: string;
  observedAt: number;
  payload: RawEventPayload;
  /** Fixture/demo data flag, surfaced in the UI (§34). */
  isDemo: boolean;
};

export function isRawEventPayload(value: unknown): value is RawEventPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.kind === "string" &&
    (RAW_PAYLOAD_KINDS as readonly string[]).includes(record.kind) &&
    typeof record.wallet === "string" &&
    typeof record.protocol === "string" &&
    typeof record.chainId === "number"
  );
}

export function isRawEventInput(value: unknown): value is RawEventInput {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.source === "string" &&
    typeof record.sourceEventId === "string" &&
    typeof record.observedAt === "number" &&
    typeof record.isDemo === "boolean" &&
    isRawEventPayload(record.payload)
  );
}
