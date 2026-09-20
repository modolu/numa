/**
 * Provider-neutral onchain adapter boundary (NUMA_ARCHITECTURE.md §12.1).
 *
 * An adapter turns one wallet into raw observations in the shared
 * `RawEventInput` shape. The rest of the pipeline (rawEvents → normalize →
 * relevance → priority → upsert) never sees a vendor response, so any
 * adapter can be swapped or added without touching it.
 */
import type { RawEventInput } from "../events/raw";
import type { ChainFamily } from "../validation/events";

export type WalletContext = {
  /** Lowercased EVM address. */
  address: string;
  chainFamily: ChainFamily;
};

export type SkippedRecord = {
  /** What was found but not turned into an observation. */
  subject: string;
  reason: string;
};

export type DiscoveryResult = {
  rawEvents: RawEventInput[];
  skipped: SkippedRecord[];
};

export interface OnchainAdapter {
  /** Stable source id, e.g. "ens". Becomes `rawEvents.source`. */
  readonly source: string;
  /** Human-readable provider description for scan status (no secrets). */
  readonly providerLabel: string;
  discover(wallet: WalletContext): Promise<DiscoveryResult>;
}

// Error model is shared with the web-source adapters.
export {
  ProviderError,
  isProviderError,
  sanitizeProviderMessage,
  toProviderError,
  type ProviderErrorKind,
} from "../providers/errors";
