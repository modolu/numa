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

export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type EventSeverity = (typeof EVENT_SEVERITIES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];
