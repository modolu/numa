import { describe, expect, test } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import { buildBrief, BRIEF_MAX_ITEMS, toBriefItem } from "../../lib/notifications/brief";
import { escapeHtml, renderBriefEmail, renderReminderEmail, renderUrgentEmail } from "../../lib/notifications/templates";
import { isTrustedActionUrl, isValidRecipient, maskEmail } from "../../lib/notifications/validation";
import { createAgentMailProvider, mapAgentMailSendResponse, toProviderIdempotencyKey } from "../../lib/notifications/agentmail";
import { verifySvixSignature } from "../../lib/notifications/webhooks";
import { digestMinutes, isValidDigestTime, isValidTimezone, localDate, localMinutes } from "../../convex/lib/localTime";

const NOW = Date.UTC(2026, 8, 20, 12, 0);
const HOUR = 3_600_000;

let counter = 0;
function event(overrides: Partial<Doc<"events">> = {}): Doc<"events"> {
  counter += 1;
  return {
    _id: `event_${counter}` as Doc<"events">["_id"],
    _creationTime: NOW,
    dedupeKey: `k${counter}`,
    userId: "user_1" as Doc<"events">["userId"],
    eventType: "ens_expiry",
    category: "deadline",
    severity: "medium",
    title: `Event ${counter}`,
    summary: "s",
    whyItMatters: "w",
    recommendedAction: "Do it",
    actionUrl: "https://app.ens.domains/x.eth",
    detectedAt: NOW,
    updatedAt: NOW,
    status: "unread",
    requiresAction: true,
    sourceType: "onchain",
    confidence: 0.9,
    priorityScore: 0.5,
    isDemo: false,
    metadata: {},
    ...overrides,
  };
}

describe("recipient and link validation", () => {
  test("recipient format and masking", () => {
    expect(isValidRecipient("alice@example.com")).toBe(true);
    expect(isValidRecipient("not-an-email")).toBe(false);
    expect(isValidRecipient(undefined)).toBe(false);
    expect(maskEmail("alice@example.com")).toBe("a****@example.com");
    expect(maskEmail("ab@x.io")).toBe("a**@x.io");
  });
  test("only https links on official hosts are trusted", () => {
    expect(isTrustedActionUrl("https://app.ens.domains/vitalik.eth")).toBe(true);
    expect(isTrustedActionUrl("https://governance.aave.com/")).toBe(true);
    expect(isTrustedActionUrl("https://www.tally.xyz/gov/arbitrum")).toBe(true);
    expect(isTrustedActionUrl("http://app.ens.domains/x")).toBe(false);
    expect(isTrustedActionUrl("https://evil.example/claim")).toBe(false);
    expect(isTrustedActionUrl("https://app.ens.domains.evil.example/")).toBe(false);
    expect(isTrustedActionUrl("https://u:p@app.aave.com/")).toBe(false);
    expect(isTrustedActionUrl(undefined)).toBe(false);
  });
});

describe("deterministic brief", () => {
  test("ranks with the inbox order, keeps at most five, excludes snoozed/completed/dismissed/expired", () => {
    const events = [
      event({ severity: "low", status: "unread" }),
      event({ severity: "critical", status: "completed" }),
      event({ severity: "high", status: "snoozed" }),
      event({ severity: "high", status: "dismissed" }),
      event({ severity: "medium", status: "expired" }),
      event({ severity: "high", status: "read", deadline: NOW + 5 * HOUR }),
      event({ severity: "high", status: "unread", deadline: NOW + 2 * HOUR }),
      event({ severity: "medium", status: "unread" }),
      event({ severity: "medium", status: "unread", requiresAction: false }),
      event({ severity: "info", status: "unread", requiresAction: false }),
      event({ severity: "info", status: "unread", requiresAction: false }),
    ];
    const brief = buildBrief(events);
    expect(brief.items).toHaveLength(BRIEF_MAX_ITEMS);
    expect(brief.items.map((i) => i.severity)).toEqual(["high", "high", "medium", "medium", "low"]);
    expect(brief.items[0].deadline).toBe(NOW + 2 * HOUR);
    expect(brief.remaining).toBe(2);
    expect(brief.headline).toBe("5 things matter today.");
    expect(brief.summary).toMatch(/4 of 5 need an action from you; 2 lower-priority items stay in the app/);
  });
  test("empty and singular cases", () => {
    expect(buildBrief([])).toMatchObject({ headline: "Nothing needs your attention today.", items: [], remaining: 0 });
    expect(buildBrief([event()]).headline).toBe("1 thing matters today.");
  });
  test("items carry only trusted links and generic vs interpreted labels", () => {
    const generic = toBriefItem(event({ actionUrl: "https://evil.example/x", sourceType: "official_web" }));
    expect(generic.actionUrl).toBeUndefined();
    expect(generic.sourceLabel).toBe("Official website");
    expect(generic.interpreted).toBe(false);
    const interpreted = toBriefItem(event({ metadata: { interpreted: true } }));
    expect(interpreted.interpreted).toBe(true);
    expect(interpreted.actionUrl).toBe("https://app.ens.domains/x.eth");
  });
});

describe("email templates", () => {
  test("escapes user-visible content and never renders untrusted links", () => {
    const item = toBriefItem(event({ title: "<script>alert(1)</script> & \"quotes\"", whyItMatters: "Go to https://evil.example", actionUrl: "https://evil.example/claim" }));
    const mail = renderBriefEmail({ headline: "1 thing matters today.", summary: "s", items: [item], remaining: 0 }, { now: NOW });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;");
    expect(mail.html).not.toContain("evil.example/claim");
    expect(mail.text).not.toContain("Official page:");
    expect(escapeHtml("a<b>'c'")).toBe("a&lt;b&gt;&#39;c&#39;");
  });
  test("renders priority labels, demo/AI badges, deadlines, trusted links and the test banner", () => {
    const items = [
      toBriefItem(event({ severity: "high", isDemo: true, deadline: NOW + 7 * HOUR, title: "Aave health factor is 1.31" })),
      toBriefItem(event({ severity: "info", metadata: { interpreted: true }, requiresAction: false, recommendedAction: undefined, actionUrl: "https://docs.ens.domains/", sourceType: "official_web" })),
    ];
    const mail = renderBriefEmail({ headline: "2 things matter today.", summary: "1 of 2 need an action from you.", items, remaining: 3 }, { now: NOW, isTest: true, appUrl: "http://localhost:3000" });
    expect(mail.subject).toBe("Numa brief · 2 things matter today.");
    expect(mail.html).toContain("Your onchain inbox");
    expect(mail.html).toContain("HIGH");
    expect(mail.html).toContain("DEMO DATA");
    expect(mail.html).toContain("AI INTERPRETED");
    expect(mail.html).toContain("Due in 7h");
    expect(mail.html).toContain('href="https://app.ens.domains/x.eth"');
    expect(mail.html).toContain('href="https://docs.ens.domains/"');
    expect(mail.html).toContain("Test message from your Numa development setup");
    expect(mail.html).toContain("3 lower-priority items stay in the app");
    expect(mail.text).toContain("YOUR NUMA BRIEF");
    expect(mail.text).toContain("1. [HIGH · DEMO DATA] Aave health factor is 1.31");
    expect(mail.text).toContain("Everything else:");
    expect(mail.html).toContain("Open Numa");
  });
  test("urgent and reminder variants", () => {
    const item = toBriefItem(event({ severity: "critical", title: "Health factor is 1.02" }));
    expect(renderUrgentEmail(item, { now: NOW }).subject).toBe("Numa · CRITICAL: Health factor is 1.02");
    const reminder = renderReminderEmail(item, "in 1h", { now: NOW });
    expect(reminder.subject).toContain("(in 1h)");
    expect(reminder.text).toContain("NUMA REMINDER");
  });
});

describe("AgentMail adapter", () => {
  const input = { to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>", idempotencyKey: "daily_brief|u|2026-09-20" };
  test("maps Numa keys onto the provider's allowed character set deterministically", () => {
    expect(toProviderIdempotencyKey("daily_brief|k97abc|2026-09-20")).toBe("daily_brief~k97abc~2026-09-20");
    expect(toProviderIdempotencyKey("reminder|u|e|24h|1789900000000")).toMatch(/^[A-Za-z0-9._~-]+$/);
    expect(toProviderIdempotencyKey("a|b")).toBe(toProviderIdempotencyKey("a|b"));
    expect(toProviderIdempotencyKey("x".repeat(300))).toHaveLength(256);
  });
  test("maps responses and rejects malformed ones", () => {
    expect(mapAgentMailSendResponse({ messageId: "m1", threadId: "t1" })).toEqual({ providerMessageId: "m1", threadId: "t1" });
    expect(mapAgentMailSendResponse({ message_id: "m2" })).toEqual({ providerMessageId: "m2", threadId: undefined });
    expect(() => mapAgentMailSendResponse({})).toThrow(/no message id/);
    expect(() => mapAgentMailSendResponse(null)).toThrow(/Empty/);
  });
  test("uses the seam, forwards the inbox id, classifies failures", async () => {
    const calls: unknown[] = [];
    const ok = createAgentMailProvider({ apiKey: "k", inboxId: "numa@agentmail.to", sendImpl: async (inbox, i) => { calls.push([inbox, i.subject, i.idempotencyKey]); return { messageId: "m1" }; } });
    expect(await ok.send(input)).toEqual({ providerMessageId: "m1", threadId: undefined });
    expect(calls).toEqual([["numa@agentmail.to", "s", "daily_brief|u|2026-09-20"]]);
    // A 409 (same key, different content) is permanent, never retried.
    const conflict = createAgentMailProvider({ apiKey: "k", inboxId: "x", sendImpl: async () => { throw Object.assign(new Error("Idempotency key reused with a different request"), { statusCode: 409 }); } });
    await expect(conflict.send(input)).rejects.toMatchObject({ kind: "permanent", status: 409 });
    const noInbox = createAgentMailProvider({ apiKey: "k", inboxId: undefined });
    await expect(noInbox.send(input)).rejects.toMatchObject({ kind: "permanent", message: /AGENTMAIL_INBOX_ID/ });
    const noKey = createAgentMailProvider({ apiKey: undefined, inboxId: "x" });
    await expect(noKey.send(input)).rejects.toMatchObject({ kind: "permanent", message: /AGENTMAIL_API_KEY/ });
    const auth = createAgentMailProvider({ apiKey: "k", inboxId: "x", sendImpl: async () => { throw Object.assign(new Error("Unauthorized"), { statusCode: 401 }); } });
    await expect(auth.send(input)).rejects.toMatchObject({ kind: "permanent", status: 401 });
    const down = createAgentMailProvider({ apiKey: "k", inboxId: "x", sendImpl: async () => { throw Object.assign(new Error("Bad gateway https://api.agentmail.to/v0"), { statusCode: 502 }); } });
    await expect(down.send(input)).rejects.toMatchObject({ kind: "transient", message: "Bad gateway [endpoint]" });
  });
});

describe("Svix webhook verification", () => {
  const secret = "whsec_" + btoa("supersecretkey1234");
  async function sign(id: string, ts: string, body: string): Promise<string> {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("supersecretkey1234"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
    return "v1," + btoa(String.fromCharCode(...new Uint8Array(sig)));
  }
  test("accepts a valid signature and rejects tampering, staleness and missing headers", async () => {
    const body = JSON.stringify({ event_type: "message.delivered", message: { message_id: "m1" } });
    const ts = String(Math.floor(NOW / 1000));
    const good = await sign("msg_1", ts, body);
    expect(await verifySvixSignature(secret, { id: "msg_1", timestamp: ts, signature: good }, body, NOW / 1000)).toEqual({ ok: true });
    expect(await verifySvixSignature(secret, { id: "msg_1", timestamp: ts, signature: `v1,other ${good}` }, body, NOW / 1000)).toEqual({ ok: true });
    expect(await verifySvixSignature(secret, { id: "msg_1", timestamp: ts, signature: good }, body + " ", NOW / 1000)).toMatchObject({ ok: false, reason: /mismatch/ });
    expect(await verifySvixSignature(secret, { id: "msg_1", timestamp: ts, signature: good }, body, NOW / 1000 + 3600)).toMatchObject({ ok: false, reason: /tolerance/ });
    expect(await verifySvixSignature(secret, { id: null, timestamp: ts, signature: good }, body, NOW / 1000)).toMatchObject({ ok: false, reason: /missing/ });
  });
});

describe("local time helpers", () => {
  test("digest windows respect the user's timezone", () => {
    expect(isValidTimezone("Europe/London")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidDigestTime("08:00")).toBe(true);
    expect(isValidDigestTime("8:00")).toBe(false);
    expect(isValidDigestTime("24:00")).toBe(false);
    expect(localDate(NOW, "UTC")).toBe("2026-09-20");
    expect(localDate(Date.UTC(2026, 8, 20, 23, 30), "Asia/Tokyo")).toBe("2026-09-21");
    expect(localMinutes(NOW, "UTC")).toBe(12 * 60);
    expect(localMinutes(NOW, "America/New_York")).toBe(8 * 60);
    expect(digestMinutes("08:30")).toBe(510);
  });
});
