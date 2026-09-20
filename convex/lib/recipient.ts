/**
 * Single development-safe recipient source (§5). Until real auth/profiles
 * exist, the demo identity has no email of its own; the deployment env var
 * `NUMA_DEV_RECIPIENT_EMAIL` supplies one. A user with a stored email (real
 * auth later) takes precedence. No address is hard-coded anywhere else.
 */
import type { Doc } from "../_generated/dataModel";
import { isValidRecipient, maskEmail } from "../../lib/notifications/validation";

export type RecipientResolution =
  | { configured: true; email: string; masked: string; source: "profile" | "development" }
  | { configured: false; reason: string };

export function resolveRecipient(user: Pick<Doc<"users">, "email">): RecipientResolution {
  if (isValidRecipient(user.email)) {
    return { configured: true, email: user.email.trim(), masked: maskEmail(user.email.trim()), source: "profile" };
  }
  const dev = process.env.NUMA_DEV_RECIPIENT_EMAIL?.trim();
  if (isValidRecipient(dev)) {
    return { configured: true, email: dev, masked: maskEmail(dev), source: "development" };
  }
  return {
    configured: false,
    reason: "No recipient email is configured. Set NUMA_DEV_RECIPIENT_EMAIL on the Convex deployment.",
  };
}
