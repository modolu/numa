/**
 * AgentMail delivery-status webhook (§16, §17). Verifies the Svix-style
 * signature with `AGENTMAIL_WEBHOOK_SECRET` before trusting anything, then
 * maps message lifecycle events onto the notification row that owns the
 * provider message id. Not registered with AgentMail until a public
 * deployment exists; without the secret it answers 503.
 */
import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { DELIVERY_EVENT_STATUS, verifySvixSignature } from "../../lib/notifications/webhooks";

export const agentMailWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (!secret) return new Response("webhook not configured", { status: 503 });

  const rawBody = await request.text();
  const verification = await verifySvixSignature(secret, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  }, rawBody);
  if (!verification.ok) return new Response(`unauthorized: ${verification.reason}`, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  if (typeof payload !== "object" || payload === null) return new Response("invalid payload", { status: 400 });
  const record = payload as Record<string, unknown>;
  const eventType = typeof record.event_type === "string" ? record.event_type : typeof record.type === "string" ? record.type : "";
  const message = typeof record.message === "object" && record.message !== null ? (record.message as Record<string, unknown>) : record;
  const providerMessageId = typeof message.message_id === "string" ? message.message_id : typeof message.messageId === "string" ? message.messageId : "";
  const status = DELIVERY_EVENT_STATUS[eventType];
  if (!status || !providerMessageId) return new Response("ignored", { status: 202 });

  await ctx.runMutation(internal.notifications.recordDeliveryEvent, { providerMessageId, status });
  return new Response("ok", { status: 200 });
});
