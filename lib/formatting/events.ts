import type {
  EventCategory,
  EventSeverity,
  EventStatus,
  EventType,
} from "../validation/events";

export const SEVERITY_LABEL: Record<EventSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  action: "Action",
  warning: "Warning",
  deadline: "Deadline",
  update: "Update",
  opportunity: "Opportunity",
  security: "Security",
  governance: "Governance",
};

export const STATUS_LABEL: Record<EventStatus, string> = {
  unread: "Unread",
  read: "Read",
  snoozed: "Snoozed",
  completed: "Completed",
  dismissed: "Dismissed",
  expired: "Expired",
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  ens_expiry: "ENS expiry",
  governance_deadline: "Governance deadline",
  bridge_claim_ready: "Bridge claim",
  token_approval_warning: "Token approval",
  protocol_migration: "Protocol migration",
  position_risk: "Position risk",
  reward_deadline: "Reward deadline",
};

export const CHAIN_LABEL: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum One",
};

export function chainLabel(chainId: number | undefined): string {
  if (chainId === undefined) return "—";
  return CHAIN_LABEL[chainId] ?? `Chain ${chainId}`;
}

/** Plural-safe "N things need your attention." */
export function attentionHeadline(count: number): string {
  if (count === 0) return "Nothing needs your attention right now.";
  if (count === 1) return "1 thing needs your attention.";
  return `${count} things need your attention.`;
}
