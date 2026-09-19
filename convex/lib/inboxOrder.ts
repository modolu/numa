/**
 * Inbox ordering (NUMA_ARCHITECTURE.md §39): most severe first, then the
 * nearest deadline, then the higher priority score, then most recently
 * detected. Pure so it can be unit-tested and reused by briefs later.
 */
import {
  SEVERITY_RANK,
  type EventSeverity,
} from "../../lib/validation/events";

export type InboxSortable = {
  severity: EventSeverity;
  deadline?: number;
  priorityScore: number;
  detectedAt: number;
};

export function compareInbox(a: InboxSortable, b: InboxSortable): number {
  const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (bySeverity !== 0) return bySeverity;

  const aDeadline = a.deadline ?? Number.POSITIVE_INFINITY;
  const bDeadline = b.deadline ?? Number.POSITIVE_INFINITY;
  if (aDeadline !== bDeadline) return aDeadline - bDeadline;

  if (a.priorityScore !== b.priorityScore) {
    return b.priorityScore - a.priorityScore;
  }
  return b.detectedAt - a.detectedAt;
}

export function sortInbox<T extends InboxSortable>(events: T[]): T[] {
  return [...events].sort(compareInbox);
}
