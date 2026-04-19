import type { AdminAlert } from "@/lib/alerts/types";

const SEVERITY_COLORS = {
  urgent: "#ef4444",
  action: "#f97316",
  info: "#3b82f6",
} as const;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function alertRow(alert: AdminAlert, appUrl: string): string {
  const color = SEVERITY_COLORS[alert.severity];
  const actionButton = alert.action_url
    ? `<a href="${appUrl}${alert.action_url}" style="display:inline-block;padding:8px 16px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:500;">Review →</a>`
    : "";

  return `
    <tr>
      <td style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <div style="width:6px;min-width:6px;align-self:stretch;background:${color};border-radius:3px;"></div>
          <div style="flex:1;">
            <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;text-transform:uppercase;color:${color};letter-spacing:0.05em;">${alert.severity}</p>
            <h3 style="margin:0 0 6px 0;font-size:15px;font-weight:600;color:#111827;">${escapeHtml(alert.title)}</h3>
            ${alert.body ? `<p style="margin:0 0 10px 0;font-size:13px;line-height:1.5;color:#4b5563;">${escapeHtml(alert.body)}</p>` : ""}
            ${actionButton}
          </div>
        </div>
      </td>
    </tr>
    <tr><td style="height:10px;"></td></tr>
  `;
}

function wrapEmail(content: string): string {
  return `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8" /><title>Astrobiz</title></head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <tr><td style="padding:8px 0 20px 0;">
            <h1 style="margin:0;font-size:18px;font-weight:700;color:#111827;">Astrobiz</h1>
            <p style="margin:2px 0 0 0;font-size:12px;color:#6b7280;">Admin Decision Alerts</p>
          </td></tr>
          ${content}
          <tr><td style="padding:20px 0;text-align:center;font-size:11px;color:#9ca3af;">
            Manage notifications at <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://astrobiz.com"}/admin/notifications" style="color:#6b7280;">the inbox</a>.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>`;
}

export function buildUrgentEmail(alerts: AdminAlert[], appUrl: string): { subject: string; html: string } {
  const count = alerts.length;
  const subject =
    count === 1
      ? `🚨 ${alerts[0].title}`
      : `🚨 ${count} urgent alerts need attention`;

  const intro = `
    <tr><td style="padding:0 0 12px 0;">
      <p style="margin:0;font-size:14px;color:#374151;">
        ${count === 1 ? "An urgent decision alert needs your attention." : `${count} urgent decision alerts need your attention.`}
      </p>
    </td></tr>
  `;
  const rows = alerts.map((a) => alertRow(a, appUrl)).join("");
  return { subject, html: wrapEmail(intro + rows) };
}

export function buildDigestEmail(alerts: AdminAlert[], appUrl: string): { subject: string; html: string } {
  const dateStr = new Date().toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const subject = `Astrobiz daily digest — ${dateStr} (${alerts.length} items)`;

  const urgents = alerts.filter((a) => a.severity === "urgent");
  const actions = alerts.filter((a) => a.severity === "action");
  const infos = alerts.filter((a) => a.severity === "info");

  const section = (label: string, items: AdminAlert[]) => {
    if (items.length === 0) return "";
    return `
      <tr><td style="padding:16px 0 8px 0;">
        <h2 style="margin:0;font-size:12px;font-weight:600;text-transform:uppercase;color:#374151;letter-spacing:0.05em;">${label} (${items.length})</h2>
      </td></tr>
      ${items.map((a) => alertRow(a, appUrl)).join("")}
    `;
  };

  const content = section("Urgent", urgents) + section("Action", actions) + section("Info", infos);
  return { subject, html: wrapEmail(content) };
}
