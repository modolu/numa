/**
 * HTTP boundary. The AgentMail lifecycle webhook is prepared but only
 * active when `AGENTMAIL_WEBHOOK_SECRET` is configured; unsigned or stale
 * deliveries are rejected (see convex/webhooks/agentmail.ts).
 */
import { httpRouter } from "convex/server";
import { agentMailWebhook } from "./webhooks/agentmail";

const http = httpRouter();

http.route({ path: "/webhooks/agentmail", method: "POST", handler: agentMailWebhook });

export default http;
