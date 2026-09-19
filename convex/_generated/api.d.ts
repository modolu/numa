/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as briefs from "../briefs.js";
import type * as crons from "../crons.js";
import type * as events from "../events.js";
import type * as ingestion_firecrawl from "../ingestion/firecrawl.js";
import type * as ingestion_fixtures from "../ingestion/fixtures.js";
import type * as ingestion_pipeline from "../ingestion/pipeline.js";
import type * as ingestion_protocols from "../ingestion/protocols.js";
import type * as ingestion_wallet from "../ingestion/wallet.js";
import type * as intelligence_normalize from "../intelligence/normalize.js";
import type * as intelligence_priority from "../intelligence/priority.js";
import type * as intelligence_relevance from "../intelligence/relevance.js";
import type * as intelligence_summarize from "../intelligence/summarize.js";
import type * as jobs_crawlSources from "../jobs/crawlSources.js";
import type * as jobs_expireEvents from "../jobs/expireEvents.js";
import type * as jobs_generateBriefs from "../jobs/generateBriefs.js";
import type * as jobs_scanWallets from "../jobs/scanWallets.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_dedupe from "../lib/dedupe.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_identity from "../lib/identity.js";
import type * as lib_inboxOrder from "../lib/inboxOrder.js";
import type * as lib_lifecycle from "../lib/lifecycle.js";
import type * as lib_validators from "../lib/validators.js";
import type * as notifications from "../notifications.js";
import type * as protocols from "../protocols.js";
import type * as rawEvents from "../rawEvents.js";
import type * as sources from "../sources.js";
import type * as subscriptions from "../subscriptions.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";
import type * as wallets from "../wallets.js";
import type * as webhooks_agentmail from "../webhooks/agentmail.js";
import type * as webhooks_firecrawl from "../webhooks/firecrawl.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  briefs: typeof briefs;
  crons: typeof crons;
  events: typeof events;
  "ingestion/firecrawl": typeof ingestion_firecrawl;
  "ingestion/fixtures": typeof ingestion_fixtures;
  "ingestion/pipeline": typeof ingestion_pipeline;
  "ingestion/protocols": typeof ingestion_protocols;
  "ingestion/wallet": typeof ingestion_wallet;
  "intelligence/normalize": typeof intelligence_normalize;
  "intelligence/priority": typeof intelligence_priority;
  "intelligence/relevance": typeof intelligence_relevance;
  "intelligence/summarize": typeof intelligence_summarize;
  "jobs/crawlSources": typeof jobs_crawlSources;
  "jobs/expireEvents": typeof jobs_expireEvents;
  "jobs/generateBriefs": typeof jobs_generateBriefs;
  "jobs/scanWallets": typeof jobs_scanWallets;
  "lib/access": typeof lib_access;
  "lib/dedupe": typeof lib_dedupe;
  "lib/hash": typeof lib_hash;
  "lib/identity": typeof lib_identity;
  "lib/inboxOrder": typeof lib_inboxOrder;
  "lib/lifecycle": typeof lib_lifecycle;
  "lib/validators": typeof lib_validators;
  notifications: typeof notifications;
  protocols: typeof protocols;
  rawEvents: typeof rawEvents;
  sources: typeof sources;
  subscriptions: typeof subscriptions;
  tasks: typeof tasks;
  users: typeof users;
  wallets: typeof wallets;
  "webhooks/agentmail": typeof webhooks_agentmail;
  "webhooks/firecrawl": typeof webhooks_firecrawl;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
