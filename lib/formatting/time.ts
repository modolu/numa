/** Small, dependency-free time formatting helpers for the inbox UI. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "in 7h", "in 12 days", "now", "2h overdue". */
export function formatDeadline(deadline: number, now: number): string {
  const delta = deadline - now;
  if (Math.abs(delta) < MINUTE) return "now";
  const past = delta < 0;
  const abs = Math.abs(delta);
  let unit: string;
  if (abs < HOUR) unit = `${Math.round(abs / MINUTE)}m`;
  else if (abs < DAY) unit = `${Math.round(abs / HOUR)}h`;
  else if (abs < 365 * DAY) {
    const days = Math.round(abs / DAY);
    unit = `${days} day${days === 1 ? "" : "s"}`;
  } else {
    const years = Math.round((abs / (365 * DAY)) * 10) / 10;
    unit = `${years} year${years === 1 ? "" : "s"}`;
  }
  return past ? `${unit} overdue` : `in ${unit}`;
}

/** "just now", "5m ago", "3h ago", "2 days ago". */
export function formatRelative(timestamp: number, now: number): string {
  const delta = now - timestamp;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.round(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.round(delta / HOUR)}h ago`;
  const days = Math.round(delta / DAY);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function formatAbsolute(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function greetingForHour(hour: number): string {
  if (hour < 5) return "Good evening.";
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}
