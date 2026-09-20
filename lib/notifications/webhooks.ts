/**
 * Svix-style webhook signature verification (AgentMail delivers lifecycle
 * events with `svix-id`, `svix-timestamp`, `svix-signature` headers signed
 * with a `whsec_` base64 secret). Pure WebCrypto; used by the HTTP boundary
 * in convex/http.ts. Unsigned or stale deliveries are never trusted.
 */

const TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SvixHeaders = { id: string | null; timestamp: string | null; signature: string | null };

export async function verifySvixSignature(
  secret: string,
  headers: SvixHeaders,
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, reason: "missing signature headers" };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return { ok: false, reason: "timestamp outside tolerance" };
  const keyBytes = base64ToBytes(secret.replace(/^whsec_/, ""));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${headers.id}.${headers.timestamp}.${rawBody}`));
  const expected = bytesToBase64(new Uint8Array(signed));
  const candidates = headers.signature.split(" ").map((s) => s.split(",")[1] ?? "");
  return candidates.some((c) => timingSafeEqual(c, expected)) ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

/** Lifecycle statuses AgentMail may report; mapped onto notification status. */
export const DELIVERY_EVENT_STATUS: Record<string, "delivered" | "bounced" | "rejected" | "complained" | "sent"> = {
  "message.delivered": "delivered",
  "message.bounced": "bounced",
  "message.rejected": "rejected",
  "message.complained": "complained",
  "message.sent": "sent",
};
