/**
 * Email rendering (§8). Calm, minimal, mobile-friendly HTML with inline
 * styles plus a plain-text alternative. Every dynamic string is escaped and
 * only links that passed `isTrustedActionUrl` are rendered.
 */
import type { EventSeverity } from "../validation/events";
import type { BriefContent, BriefItem } from "./brief";
import { isTrustedActionUrl } from "./validation";

export const MAIL_SUBJECT_PREFIX = "Numa";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SEVERITY_LABEL: Record<EventSeverity, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  info: "INFO",
};
const SEVERITY_COLOR: Record<EventSeverity, string> = {
  critical: "#b3261e",
  high: "#b45309",
  medium: "#8a6a00",
  low: "#3d5a80",
  info: "#5f6470",
};

function formatDeadline(deadline: number | undefined, now: number): string | null {
  if (deadline === undefined) return null;
  const delta = deadline - now;
  const abs = Math.abs(delta);
  const hours = Math.round(abs / 3_600_000);
  const text = hours < 1 ? "now" : hours < 48 ? `${hours}h` : `${Math.round(hours / 24)} days`;
  return delta < 0 ? `${text} overdue` : `in ${text}`;
}

export type RenderedEmail = { subject: string; text: string; html: string };

type RenderOptions = { now: number; appUrl?: string; isTest?: boolean };

function shell(title: string, intro: string, bodyHtml: string, options: RenderOptions): string {
  const test = options.isTest ? `<p style="margin:0 0 16px;font-size:12px;color:#8a8a94;text-transform:uppercase;letter-spacing:.08em;">Test message from your Numa development setup</p>` : "";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#17171a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e4df;border-radius:14px;padding:28px 24px;">
<tr><td>
${test}
<p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#8a8a94;">Numa</p>
<p style="margin:0 0 20px;font-size:13px;color:#4b4b55;">Your onchain inbox</p>
<h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:600;">${escapeHtml(title)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4b4b55;">${escapeHtml(intro)}</p>
${bodyHtml}
<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#8a8a94;">Read-only monitoring. Numa never holds funds or signs transactions. Links point only to official protocol pages.${options.appUrl && isTrustedAppUrl(options.appUrl) ? ` <a href="${escapeHtml(options.appUrl)}" style="color:#3b3fd6;">Open Numa</a>.` : ""}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function isTrustedAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.hostname === "localhost";
  } catch {
    return false;
  }
}

function itemHtml(item: BriefItem, index: number | null, options: RenderOptions): string {
  const deadline = formatDeadline(item.deadline, options.now);
  const link = isTrustedActionUrl(item.actionUrl)
    ? `<a href="${escapeHtml(item.actionUrl)}" style="color:#3b3fd6;font-weight:500;">Open official page</a>`
    : "";
  const badges = [
    `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;letter-spacing:.08em;color:${SEVERITY_COLOR[item.severity]};background:#f1f0ec;">${SEVERITY_LABEL[item.severity]}</span>`,
    item.isDemo ? `<span style="display:inline-block;margin-left:6px;padding:2px 8px;border:1px dashed #d4d1ca;border-radius:6px;font-size:11px;letter-spacing:.08em;color:#8a8a94;">DEMO DATA</span>` : "",
    item.interpreted ? `<span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:6px;font-size:11px;letter-spacing:.08em;color:#3b3fd6;background:#eceefb;">AI INTERPRETED</span>` : "",
  ].join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e6e4df;padding:16px 0;">
<tr><td style="padding:16px 0;">
<p style="margin:0 0 6px;">${badges}</p>
<p style="margin:0 0 6px;font-size:16px;font-weight:600;line-height:1.4;">${index !== null ? `${index}. ` : ""}${escapeHtml(item.title)}</p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#4b4b55;">${escapeHtml(item.whyItMatters)}</p>
<p style="margin:0;font-size:14px;line-height:1.6;">${item.recommendedAction ? `<strong>Next:</strong> ${escapeHtml(item.recommendedAction)}` : ""}${deadline ? ` <span style="color:#8a8a94;">· Due ${escapeHtml(deadline)}</span>` : ""}${link ? ` · ${link}` : ""}</p>
<p style="margin:6px 0 0;font-size:12px;color:#8a8a94;">Source: ${escapeHtml(item.sourceLabel)}</p>
</td></tr>
</table>`;
}

function itemText(item: BriefItem, index: number | null, options: RenderOptions): string {
  const deadline = formatDeadline(item.deadline, options.now);
  const lines = [
    `${index !== null ? `${index}. ` : ""}[${SEVERITY_LABEL[item.severity]}${item.isDemo ? " · DEMO DATA" : ""}${item.interpreted ? " · AI INTERPRETED" : ""}] ${item.title}`,
    `   ${item.whyItMatters}`,
  ];
  if (item.recommendedAction) lines.push(`   Next: ${item.recommendedAction}${deadline ? ` (due ${deadline})` : ""}`);
  else if (deadline) lines.push(`   Due ${deadline}`);
  if (isTrustedActionUrl(item.actionUrl)) lines.push(`   Official page: ${item.actionUrl}`);
  lines.push(`   Source: ${item.sourceLabel}`);
  return lines.join("\n");
}

export function renderBriefEmail(brief: BriefContent, options: RenderOptions): RenderedEmail {
  const subject = `${MAIL_SUBJECT_PREFIX} brief · ${brief.headline}`;
  const everythingElse =
    brief.remaining > 0
      ? `${brief.remaining} lower-priority item${brief.remaining === 1 ? "" : "s"} stay in the app.`
      : "No action needed.";
  const text = [
    options.isTest ? "TEST MESSAGE FROM YOUR NUMA DEVELOPMENT SETUP\n" : "",
    "YOUR NUMA BRIEF",
    "",
    brief.headline,
    brief.summary,
    "",
    ...brief.items.map((item, i) => itemText(item, i + 1, options) + "\n"),
    "Everything else:",
    everythingElse,
    "",
    "Read-only monitoring. Numa never holds funds or signs transactions.",
  ]
    .filter((l) => l !== "")
    .join("\n");
  const html = shell(
    brief.headline,
    brief.summary,
    `${brief.items.map((item, i) => itemHtml(item, i + 1, options)).join("")}
<p style="margin:16px 0 0;font-size:13px;color:#8a8a94;"><strong style="color:#4b4b55;">Everything else:</strong> ${escapeHtml(everythingElse)}</p>`,
    options,
  );
  return { subject, text, html };
}

export function renderUrgentEmail(item: BriefItem, options: RenderOptions): RenderedEmail {
  const subject = `${MAIL_SUBJECT_PREFIX} · ${SEVERITY_LABEL[item.severity]}: ${item.title}`;
  const intro = "One item needs your attention now.";
  const text = [
    options.isTest ? "TEST MESSAGE FROM YOUR NUMA DEVELOPMENT SETUP\n" : "",
    "NUMA ALERT",
    "",
    intro,
    "",
    itemText(item, null, options),
    "",
    "Read-only monitoring. Numa never holds funds or signs transactions.",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { subject, text, html: shell(item.title, intro, itemHtml(item, null, options), options) };
}

export function renderReminderEmail(item: BriefItem, offsetLabel: string, options: RenderOptions): RenderedEmail {
  const subject = `${MAIL_SUBJECT_PREFIX} reminder · ${item.title} (${offsetLabel})`;
  const intro = `Deadline reminder: this item is due ${offsetLabel}.`;
  const text = [
    "NUMA REMINDER",
    "",
    intro,
    "",
    itemText(item, null, options),
    "",
    "Read-only monitoring. Numa never holds funds or signs transactions.",
  ].join("\n");
  return { subject, text, html: shell(item.title, intro, itemHtml(item, null, options), options) };
}
