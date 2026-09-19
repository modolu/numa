import { describe, expect, test } from "vitest";
import {
  allowedTransitions,
  assertTransition,
  canComplete,
  canTransition,
  InvalidTransitionError,
  isTerminalStatus,
  isValidSnoozeUntil,
} from "../../convex/lib/lifecycle";
import { EVENT_STATUSES } from "../../lib/validation/events";

describe("event lifecycle", () => {
  test("unread can move to every non-initial state", () => {
    expect(allowedTransitions("unread")).toEqual([
      "read",
      "snoozed",
      "completed",
      "dismissed",
      "expired",
    ]);
  });

  test("read cannot go back to unread", () => {
    expect(canTransition("read", "unread")).toBe(false);
    expect(canTransition("read", "snoozed")).toBe(true);
  });

  test("snoozed wakes up to unread or opens as read", () => {
    expect(canTransition("snoozed", "unread")).toBe(true);
    expect(canTransition("snoozed", "read")).toBe(true);
  });

  test("terminal states never transition", () => {
    for (const terminal of ["completed", "dismissed", "expired"] as const) {
      expect(isTerminalStatus(terminal)).toBe(true);
      for (const to of EVENT_STATUSES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });

  test("assertTransition throws a typed error", () => {
    expect(() => assertTransition("completed", "read")).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertTransition("unread", "read")).not.toThrow();
  });

  test("only actionable, non-terminal events can be completed", () => {
    expect(canComplete({ status: "unread", requiresAction: true })).toBe(true);
    expect(canComplete({ status: "unread", requiresAction: false })).toBe(false);
    expect(canComplete({ status: "completed", requiresAction: true })).toBe(false);
  });

  test("snooze must be in the future", () => {
    expect(isValidSnoozeUntil(200, 100)).toBe(true);
    expect(isValidSnoozeUntil(100, 100)).toBe(false);
    expect(isValidSnoozeUntil(Number.NaN, 100)).toBe(false);
  });
});
