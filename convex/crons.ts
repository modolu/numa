/**
 * Recurring jobs (NUMA_ARCHITECTURE.md §8).
 *
 * Wallet rescans run every 6 hours — ENS expiries move on a scale of days,
 * so this keeps public-RPC usage negligible while still catching renewals.
 * Official-source crawls are scheduled every 15 minutes, but each source
 * only actually crawls when its own policy says it is due (governance 30m,
 * updates 3h, docs 6h), so Firecrawl usage stays small and predictable.
 * Event expiry and brief generation arrive in later milestones.
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("scan monitored wallets", { hours: 6 }, internal.jobs.scanWallets.run, {});
crons.interval("crawl official sources", { minutes: 15 }, internal.jobs.crawlSources.run, {});

export default crons;
