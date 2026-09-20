/**
 * Recurring jobs (NUMA_ARCHITECTURE.md §8).
 *
 * Wallet rescans run every 6 hours — ENS expiries move on a scale of days,
 * so this keeps public-RPC usage negligible while still catching renewals.
 * Source recrawls, event expiry and brief generation arrive in later
 * milestones.
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("scan monitored wallets", { hours: 6 }, internal.jobs.scanWallets.run, {});

export default crons;
