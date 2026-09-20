/**
 * Provider-neutral email boundary (NUMA_ARCHITECTURE.md §22). Numa renders
 * trusted content itself; the provider only transports it. The rest of Numa
 * never sees an AgentMail response shape.
 */

export type EmailSendInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Stable key for the logical message, for providers that support it. */
  idempotencyKey: string;
};

export type EmailSendResult = {
  providerMessageId: string;
  threadId?: string;
};

export interface EmailProvider {
  readonly provider: string;
  readonly providerLabel: string;
  send(input: EmailSendInput): Promise<EmailSendResult>;
}
