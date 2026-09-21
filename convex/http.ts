/**
 * HTTP boundary.
 *
 * - `/webhooks/agentmail`: AgentMail delivery-status webhook (Svix-verified,
 *   503 until `AGENTMAIL_WEBHOOK_SECRET` is configured).
 * - Numa's pages: the frontend is a Next.js static export served by the
 *   Convex static-hosting component. The component serves exact asset paths
 *   and falls back to `/index.html` for unknown extension-less paths, so each
 *   page route below maps its clean URL to the exported `<page>.html`.
 * - Everything else: the component's static catch-all.
 */
import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components } from "./_generated/api";
import { agentMailWebhook } from "./webhooks/agentmail";
import { servePage } from "./staticSite";

const http = httpRouter();

http.route({ path: "/webhooks/agentmail", method: "POST", handler: agentMailWebhook });

for (const page of ["inbox", "event", "tasks", "brief", "wallets", "settings"]) {
  http.route({ path: `/${page}`, method: "GET", handler: servePage(`/${page}.html`) });
}

registerStaticRoutes(http, components.staticHosting);

export default http;
