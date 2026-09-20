/**
 * Deterministic daily brief (NUMA_ARCHITECTURE.md §4.3, §23). Built only
 * from canonical Numa events: rank with the inbox order, keep the few that
 * still need the user, and persist a self-contained snapshot so the email
 * renders the same even if the events change afterwards. No model call.
 */
import type { Doc } from "../../convex/_generated/dataModel";
import { sortInbox } from "../../convex/lib/inboxOrder";
import type { EventSeverity } from "../validation/events";
import { isTrustedActionUrl } from "./validation";

export const BRIEF_MAX_ITEMS = 5;

export type BriefItem = {
  eventId: Doc<"events">["_id"];
  title: string;
  whyItMatters: string;
  recommendedAction?: string;
  severity: EventSeverity;
  category: Doc<"events">["category"];
  deadline?: number;
  /** Trusted, validated link only; absent otherwise. */
  actionUrl?: string;
  sourceLabel: string;
  isDemo: boolean;
  interpreted: boolean;
};

export type BriefContent = {
  headline: string;
  summary: string;
  items: BriefItem[];
  /** How many active items were left out of the top list. */
  remaining: number;
};

const SOURCE_LABEL: Record<Doc<"events">["sourceType"], string> = {
  onchain: "Onchain data",
  official_web: "Official website",
  governance: "Governance",
};

/** Events still asking for attention: unread or read, never snoozed/done. */
export function isBriefEligible(event: Doc<"events">): boolean {
  return event.status === "unread" || event.status === "read";
}

export function toBriefItem(event: Doc<"events">): BriefItem {
  return {
    eventId: event._id,
    title: event.title,
    whyItMatters: event.whyItMatters,
    recommendedAction: event.recommendedAction,
    severity: event.severity,
    category: event.category,
    deadline: event.deadline,
    actionUrl: isTrustedActionUrl(event.actionUrl) ? event.actionUrl : undefined,
    sourceLabel: SOURCE_LABEL[event.sourceType],
    isDemo: event.isDemo,
    interpreted: event.metadata.interpreted === true,
  };
}

export function headlineFor(count: number): string {
  if (count === 0) return "Nothing needs your attention today.";
  if (count === 1) return "1 thing matters today.";
  return `${count} things matter today.`;
}

export function buildBrief(events: Doc<"events">[], maxItems = BRIEF_MAX_ITEMS): BriefContent {
  const eligible = sortInbox(events.filter(isBriefEligible));
  const chosen = eligible.slice(0, maxItems);
  const remaining = eligible.length - chosen.length;
  const actionable = chosen.filter((e) => e.requiresAction).length;
  const summary =
    chosen.length === 0
      ? "Your monitored wallet has no open items. Numa keeps watching."
      : `${actionable} of ${chosen.length} need an action from you${remaining > 0 ? `; ${remaining} lower-priority item${remaining === 1 ? "" : "s"} stay in the app` : ""}.`;
  return {
    headline: headlineFor(chosen.length),
    summary,
    items: chosen.map(toBriefItem),
    remaining,
  };
}
