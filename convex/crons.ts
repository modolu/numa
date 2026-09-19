/**
 * Recurring jobs (NUMA_ARCHITECTURE.md §8). No jobs are registered in this
 * milestone; wallet rescans, source recrawls, event expiry and brief
 * generation are added in later milestones.
 */
import { cronJobs } from "convex/server";

const crons = cronJobs();

export default crons;
