/** Timezone helpers for per-user digest scheduling (§12). */

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidDigestTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** YYYY-MM-DD of `now` in the user's timezone. */
export function localDate(now: number, timezone: string): string {
  const tz = isValidTimezone(timezone) ? timezone : "UTC";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

/** Minutes since local midnight of `now` in the user's timezone. */
export function localMinutes(now: number, timezone: string): number {
  const tz = isValidTimezone(timezone) ? timezone : "UTC";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(now));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function digestMinutes(digestTime: string): number {
  const [h, m] = digestTime.split(":").map(Number);
  return h * 60 + m;
}
