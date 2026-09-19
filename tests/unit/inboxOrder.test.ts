import { describe, expect, test } from "vitest";
import { sortInbox } from "../../convex/lib/inboxOrder";

describe("inbox ordering", () => {
  test("severity first, then nearest deadline, then score, then recency", () => {
    const sorted = sortInbox([
      { id: "low", severity: "low", priorityScore: 0.3, detectedAt: 5 },
      { id: "med-late", severity: "medium", deadline: 200, priorityScore: 0.6, detectedAt: 1 },
      { id: "med-soon", severity: "medium", deadline: 100, priorityScore: 0.5, detectedAt: 1 },
      { id: "med-none-old", severity: "medium", priorityScore: 0.55, detectedAt: 1 },
      { id: "med-none-new", severity: "medium", priorityScore: 0.55, detectedAt: 9 },
      { id: "med-none-high", severity: "medium", priorityScore: 0.65, detectedAt: 1 },
      { id: "critical", severity: "critical", priorityScore: 0.9, detectedAt: 1 },
      { id: "high", severity: "high", priorityScore: 0.75, detectedAt: 1 },
    ]);
    expect(sorted.map((e) => e.id)).toEqual([
      "critical",
      "high",
      "med-soon",
      "med-late",
      "med-none-high",
      "med-none-new",
      "med-none-old",
      "low",
    ]);
  });

  test("does not mutate its input", () => {
    const input = [
      { severity: "low" as const, priorityScore: 0.1, detectedAt: 1 },
      { severity: "high" as const, priorityScore: 0.8, detectedAt: 1 },
    ];
    sortInbox(input);
    expect(input[0].severity).toBe("low");
  });
});
