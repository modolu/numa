/**
 * Recurring jobs (NUMA_ARCHITECTURE.md §8).
 *
 * Wallet rescans run every 6 hours — ENS expiries move on a scale of days,
 * so this keeps public-RPC usage negligible while still catching renewals.
 * Official-source crawls are scheduled every 15 minutes, but each source
 * only actually crawls when its own policy says it is due (governance 30m,
 * updates 3h, docs 6h), so Firecrawl usage stays small and predictable.
 * Daily briefs are queued by a 15-minute job that honours each user's
 * digest time and timezone. Event expiry arrives in a later milestone.
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("scan monitored wallets", { hours: 6 }, internal.jobs.scanWallets.run, {});
crons.interval("crawl official sources", { minutes: 15 }, internal.jobs.crawlSources.run, {});
// Daily briefs: each user's own digest time/timezone is checked inside the
// job; the 15-minute cadence sits inside its 30-minute delivery window.
crons.interval("send daily briefs", { minutes: 15 }, internal.jobs.sendDigests.run, {});
// Deadline reminders are only placed on the scheduler within a 30-day
// horizon; this sweep picks up deadlines as they come into range.
crons.interval("reconcile deadline reminders", { hours: 6 }, internal.notifications.reconcileDueReminders, {});

export default crons;
