import { describe, expect, test } from "vitest";
import {
  computePriorityScore,
  exposureForUsd,
  PRIORITY_WEIGHTS,
  scorePriority,
  severityForScore,
  urgencyForDeadline,
} from "../../convex/intelligence/priority";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("priority score", () => {
  test("weights sum to 1 and match the architecture", () => {
    expect(PRIORITY_WEIGHTS).toEqual({
      urgency: 0.3,
      financialExposure: 0.25,
      actionRequirement: 0.2,
      securityImpact: 0.15,
      sourceConfidence: 0.1,
    });
    const total = Object.values(PRIORITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
  });

  test("computes the weighted sum exactly", () => {
    const score = computePriorityScore({
      urgency: 1,
      financialExposure: 0.5,
      actionRequirement: 1,
      securityImpact: 0,
      sourceConfidence: 1,
    });
    expect(score).toBeCloseTo(0.3 + 0.125 + 0.2 + 0 + 0.1, 4);
  });

  test("clamps out-of-range factors instead of producing nonsense", () => {
    const score = computePriorityScore({
      urgency: 5,
      financialExposure: -1,
      actionRequirement: Number.NaN,
      securityImpact: 1,
      sourceConfidence: 1,
    });
    expect(score).toBeCloseTo(0.3 + 0 + 0 + 0.15 + 0.1, 4);
  });

  test("maps scores to severities at the documented thresholds", () => {
    expect(severityForScore(0.85)).toBe("critical");
    expect(severityForScore(0.849)).toBe("high");
    expect(severityForScore(0.7)).toBe("high");
    expect(severityForScore(0.699)).toBe("medium");
    expect(severityForScore(0.45)).toBe("medium");
    expect(severityForScore(0.449)).toBe("low");
    expect(severityForScore(0.2)).toBe("low");
    expect(severityForScore(0.199)).toBe("info");
    expect(severityForScore(0)).toBe("info");
  });

  test("scorePriority returns normalized factors alongside the result", () => {
    const result = scorePriority({
      urgency: 1,
      financialExposure: 1,
      actionRequirement: 1,
      securityImpact: 1,
      sourceConfidence: 1,
    });
    expect(result.score).toBe(1);
    expect(result.severity).toBe("critical");
    expect(result.factors.urgency).toBe(1);
  });
});

describe("factor helpers", () => {
  test("urgency rises as the deadline approaches", () => {
    const now = 1_000_000_000_000;
    const at = (ms: number) => urgencyForDeadline(now + ms, now);
    expect(at(-HOUR)).toBe(1);
    expect(at(30 * 60_000)).toBe(1);
    expect(at(7 * HOUR)).toBe(0.9);
    expect(at(2 * DAY)).toBe(0.75);
    expect(at(6 * DAY)).toBe(0.55);
    expect(at(12 * DAY)).toBe(0.3);
    expect(at(30 * DAY)).toBe(0.2);
    expect(at(90 * DAY)).toBe(0.1);
    expect(at(HOUR)).toBeGreaterThan(at(DAY));
  });

  test("exposure tiers are monotonic", () => {
    expect(exposureForUsd(undefined)).toBe(0);
    expect(exposureForUsd(0)).toBe(0);
    expect(exposureForUsd(50)).toBe(0.1);
    expect(exposureForUsd(500)).toBe(0.3);
    expect(exposureForUsd(8_400)).toBe(0.65);
    expect(exposureForUsd(50_000)).toBe(0.85);
    expect(exposureForUsd(1_000_000)).toBe(1);
  });
});
