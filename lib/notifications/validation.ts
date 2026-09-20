/**
 * Recipient and link validation for outbound mail (§8, §26). Only trusted
 * action links — official protocol hosts Numa already allow-lists — are ever
 * rendered into an email; anything else is dropped silently.
 */
import { KNOWN_PROTOCOLS } from "../../convex/protocols";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidRecipient(value: string | undefined | null): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value.trim());
}

/** `a***@example.com` — enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, 1);
  return `${head}${"*".repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}

/** Official app hosts the fixtures and adapters link to, plus source hosts. */
export const TRUSTED_LINK_HOSTS: readonly string[] = Array.from(
  new Set([
    ...KNOWN_PROTOCOLS.flatMap((p) => p.officialHosts),
    "app.ens.domains",
    "app.aave.com",
    "governance.aave.com",
    "tally.xyz",
    "bridge.arbitrum.io",
    "docs.arbitrum.io",
    "forum.arbitrum.foundation",
  ]),
);

export function isTrustedActionUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return TRUSTED_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
