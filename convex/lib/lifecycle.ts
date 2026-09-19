/**
 * Event lifecycle rules (NUMA_ARCHITECTURE.md §4.1, §20).
 *
 * Pure functions: no Convex imports, so they are unit-testable and reusable
 * by the scheduler wake-up / expiry jobs in a later milestone.
 */
import {
  TERMINAL_STATUSES,
  type EventStatus,
} from "../../lib/validation/events";

const TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  unread: ["read", "snoozed", "completed", "dismissed", "expired"],
  read: ["snoozed", "completed", "dismissed", "expired"],
  // `unread` is the scheduler wake-up path; `read` is the user opening it.
  snoozed: ["unread", "read", "completed", "dismissed", "expired"],
  completed: [],
  dismissed: [],
  expired: [],
};

export function isTerminalStatus(status: EventStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: EventStatus): readonly EventStatus[] {
  return TRANSITIONS[from];
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: EventStatus,
    public readonly to: EventStatus,
  ) {
    super(`Cannot move an event from "${from}" to "${to}"`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: EventStatus, to: EventStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/** Completion only makes sense for events that asked the user to act. */
export function canComplete(event: {
  status: EventStatus;
  requiresAction: boolean;
}): boolean {
  return event.requiresAction && canTransition(event.status, "completed");
}

/** A snooze must point into the future. */
export function isValidSnoozeUntil(until: number, now: number): boolean {
  return Number.isFinite(until) && until > now;
}
