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

export type ProviderErrorKind =
  /** Network / rate limit / 5xx — safe to retry later. */
  | "transient"
  /** Bad request, unsupported input, permanent 4xx — do not retry blindly. */
  | "permanent"
  /** The provider answered but the data did not match the expected shape. */
  | "malformed";

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: ProviderErrorKind,
    public readonly source: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

const MAX_MESSAGE = 200;

/**
 * Reduce a provider/library error to one short line with no URLs, so a
 * keyed RPC endpoint can never leak into scan status, logs or the UI.
 */
export function sanitizeProviderMessage(error: unknown): string {
  let message: string;
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    message =
      typeof record.shortMessage === "string"
        ? record.shortMessage
        : error instanceof Error
          ? error.message
          : String(error);
  } else {
    message = String(error);
  }
  const firstLine = message.split("\n")[0] ?? "";
  const withoutUrls = firstLine.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[endpoint]");
  const trimmed = withoutUrls.trim() || "Provider request failed";
  return trimmed.length > MAX_MESSAGE ? `${trimmed.slice(0, MAX_MESSAGE - 1)}…` : trimmed;
}

/** Map an unknown thrown value to a ProviderError without leaking internals. */
export function toProviderError(error: unknown, source: string): ProviderError {
  if (isProviderError(error)) return error;
  const message = sanitizeProviderMessage(error);
  const status = extractStatus(error);
  if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
    return new ProviderError(message, "permanent", source, status);
  }
  return new ProviderError(message, "transient", source, status);
}

function extractStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  return typeof status === "number" ? status : undefined;
}
