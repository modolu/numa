/**
 * Official-source validation. Only sources on an allow-listed host for a
 * known protocol may enter `protocolSources`; user-supplied URLs are not
 * accepted in this milestone (NUMA_ARCHITECTURE.md §2.3, §27).
 */
import { PROTOCOL_SOURCE_TYPES, type ProtocolSourceType } from "../events/raw";

export type SourceCandidate = {
  protocolSlug: string;
  url: string;
  sourceType: ProtocolSourceType;
};

export type SourceValidation =
  | { ok: true; url: string; hostname: string }
  | { ok: false; reason: string };

function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

export function validateOfficialSource(
  candidate: SourceCandidate,
  allowedHosts: readonly string[],
): SourceValidation {
  if (!(PROTOCOL_SOURCE_TYPES as readonly string[]).includes(candidate.sourceType)) {
    return { ok: false, reason: `Unknown source type "${candidate.sourceType}"` };
  }
  if (allowedHosts.length === 0) {
    return { ok: false, reason: `No official hosts registered for "${candidate.protocolSlug}"` };
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate.url);
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Only https:// sources are allowed" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "Credentials in URLs are not allowed" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostAllowed(hostname, allowedHosts)) {
    return {
      ok: false,
      reason: `${hostname} is not an official host for "${candidate.protocolSlug}"`,
    };
  }
  parsed.hash = "";
  return { ok: true, url: parsed.toString(), hostname };
}
