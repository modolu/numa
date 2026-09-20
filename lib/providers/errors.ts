/**
 * Provider error model shared by every external adapter (onchain RPC,
 * Firecrawl, later OpenAI/AgentMail). Classifies failures so callers can
 * decide whether a retry makes sense (NUMA_ARCHITECTURE.md §28, §29) and
 * guarantees no endpoint or credential ever leaks into stored status.
 */

export type ProviderErrorKind =
  /** Network / rate limit / 5xx — safe to retry later. */
  | "transient"
  /** Bad request, auth, unsupported input, permanent 4xx — do not retry blindly. */
  | "permanent"
  /** The provider answered but the data did not match the expected shape. */
  | "malformed"
  /** A model declined to answer; retrying the same input is pointless. */
  | "refusal";

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
 * keyed endpoint or bearer token can never leak into scan status, logs or
 * the UI.
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
  const withoutTokens = withoutUrls.replace(/\b(fc|sk)-[A-Za-z0-9_-]{6,}\b/g, "[redacted]");
  const trimmed = withoutTokens.trim() || "Provider request failed";
  return trimmed.length > MAX_MESSAGE ? `${trimmed.slice(0, MAX_MESSAGE - 1)}…` : trimmed;
}

function extractStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  return typeof status === "number" ? status : undefined;
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
