/**
 * AgentMail implementation of the email provider (§22). Sends from a
 * pre-configured AgentMail inbox (`AGENTMAIL_INBOX_ID`); the API key never
 * leaves the action that constructs this adapter.
 *
 * Provider notes: `send` returns a message id on success. AgentMail honours
 * an `Idempotency-Key` header (24h, organization-scoped): a retry with the
 * same key and identical content returns the original message id without a
 * second email, and the same key with different content is a 409. Numa
 * passes its deterministic notification identity as that key and renders
 * each notification from a fixed timestamp so retries are byte-identical;
 * its own dedupe keys and `sending` claim remain the primary guarantee.
 */
import { AgentMailClient } from "agentmail";
import { ProviderError, toProviderError } from "../providers/errors";
import type { EmailProvider, EmailSendInput, EmailSendResult } from "./provider";

export const AGENTMAIL_PROVIDER = "agentmail";

export type AgentMailAdapterOptions = {
  apiKey: string | undefined;
  inboxId: string | undefined;
  /** Test seam replacing the SDK call (receives the idempotency key via `input`). */
  sendImpl?: (inboxId: string, input: EmailSendInput) => Promise<unknown>;
};

/**
 * AgentMail idempotency keys allow only `A-Z a-z 0-9 - . _ ~` (1–256 chars).
 * Numa's logical key uses `|` separators, so map it deterministically.
 */
export function toProviderIdempotencyKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._~-]/g, "~").slice(0, 256);
}

export function mapAgentMailSendResponse(response: unknown): EmailSendResult {
  if (typeof response !== "object" || response === null) {
    throw new ProviderError("Empty send response", "malformed", AGENTMAIL_PROVIDER);
  }
  const r = response as Record<string, unknown>;
  const messageId = typeof r.messageId === "string" ? r.messageId : typeof r.message_id === "string" ? r.message_id : "";
  if (!messageId) throw new ProviderError("Send response had no message id", "malformed", AGENTMAIL_PROVIDER);
  const threadId = typeof r.threadId === "string" ? r.threadId : typeof r.thread_id === "string" ? r.thread_id : undefined;
  return { providerMessageId: messageId, threadId };
}

export function createAgentMailProvider(options: AgentMailAdapterOptions): EmailProvider {
  const sendImpl =
    options.sendImpl ??
    (async (inboxId: string, input: EmailSendInput) => {
      if (!options.apiKey) {
        throw new ProviderError("AGENTMAIL_API_KEY is not configured on this deployment", "permanent", AGENTMAIL_PROVIDER);
      }
      const client = new AgentMailClient({ apiKey: options.apiKey });
      return await client.inboxes.messages.send(
        inboxId,
        {
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
          labels: ["numa", input.idempotencyKey.split("|")[0] ?? "numa"],
        },
        { idempotencyKey: toProviderIdempotencyKey(input.idempotencyKey) },
      );
    });

  return {
    provider: AGENTMAIL_PROVIDER,
    providerLabel: "AgentMail",
    async send(input) {
      if (!options.inboxId) {
        throw new ProviderError("AGENTMAIL_INBOX_ID is not configured on this deployment", "permanent", AGENTMAIL_PROVIDER);
      }
      let response: unknown;
      try {
        response = await sendImpl(options.inboxId, input);
      } catch (error) {
        throw toProviderError(error, AGENTMAIL_PROVIDER);
      }
      return mapAgentMailSendResponse(response);
    },
  };
}
