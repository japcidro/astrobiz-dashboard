import type { BriefingData, BriefingType } from "./types";

function formatPHP(n: number): string {
  return `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function deltaLabel(pct: number | null): string {
  if (pct === null) return "";
  const sign = pct >= 0 ? "+" : "";
  const color = pct >= 0 ? "#10b981" : "#ef4444";
  return `<span style="color:${color};font-weight:600;">${sign}${pct.toFixed(1)}%</span>`;
}

function sectionHeader(label: string): string {
  return `<tr><td style="padding:24px 0 10px 0;">
    <h2 style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280;letter-spacing:0.08em;">${escapeHtml(label)}</h2>
  </td></tr>`;
}

function metricRow(label: string, value: string, extra?: string): string {
  return `<tr><td style="padding:4px 0;border-bottom:1px solid #e5e7eb;">
    <table width="100%" role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:8px 0;font-size:13px;color:#4b5563;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;font-size:13px;color:#111827;font-weight:600;text-align:right;">${value}${extra ? ` ${extra}` : ""}</td>
    </tr></table>
  </td></tr>`;
}

function listItem(primary: string, secondary: string): string {
  return `<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">
    <div style="color:#111827;font-weight:500;">${escapeHtml(primary)}</div>
    <div style="color:#6b7280;font-size:12px;margin-top:2px;">${escapeHtml(secondary)}</div>
  </td></tr>`;
}

function aiSummaryBlock(summary: string | null): string {
  if (!summary) return "";
  const paragraphs = summary
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#1f2937;">${escapeHtml(p)}</p>`)
    .join("");
  return `<tr><td style="padding:16px 20px;background:#f9fafb;border-radius:8px;border-left:3px solid #111827;">
    <p style="margin:0 0 10px 0;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280;letter-spacing:0.08em;">Summary</p>
    ${paragraphs}
  </td></tr>
  <tr><td style="height:10px;"></td></tr>`;
}

export function buildBriefingEmail(
  type: BriefingType,
  periodLabel: string,
  data: BriefingData,
  aiSummary: string | null,
  appUrl: string,
  briefingId: string
): { subject: string; html: string } {
  const typeLabel: Record<BriefingType, string> = {
    morning: "Morning Briefing",
    evening: "Evening Report",
    weekly: "Weekly Review",
    monthly: "Monthly Review",
  };

  const subject = `${typeLabel[type]} — ${formatPHP(data.revenue)} revenue, ${data.roas.toFixed(2)}x ROAS`;

  const sections: string[] = [];

  // Header
  sections.push(`<tr><td style="padding:0 0 8px 0;">
    <p style="margin:0;font-size:12px;color:#6b7280;">${escapeHtml(typeLabel[type])}</p>
    <h1 style="margin:4px 0 0 0;font-size:22px;font-weight:700;color:#111827;">${escapeHtml(periodLabel)}</h1>
  </td></tr>
  <tr><td style="padding:12px 0;"></td></tr>`);

  // AI summary
  sections.push(aiSummaryBlock(aiSummary));

  // Financial
  sections.push(sectionHeader("Financial"));
  sections.push(`<tr><td><table width="100%" role="presentation" cellpadding="0" cellspacing="0">
    ${metricRow("Revenue", formatPHP(data.revenue), deltaLabel(data.revenue_delta_pct))}
    ${metricRow("Net profit (est.)", formatPHP(data.net_profit_est), deltaLabel(data.profit_delta_pct))}
    ${metricRow("Orders", String(data.orders))}
    ${metricRow("Ad spend", formatPHP(data.ad_spend))}
    ${metricRow("ROAS", `${data.roas.toFixed(2)}x`)}
    ${data.cpa > 0 ? metricRow("CPA", formatPHP(data.cpa)) : ""}
  </table></td></tr>`);

  // Operations
  sections.push(sectionHeader("Operations"));
  sections.push(`<tr><td><table width="100%" role="presentation" cellpadding="0" cellspacing="0">
    ${metricRow("Unfulfilled orders", `${data.unfulfilled_count}${data.aging_count > 0 ? ` (${data.aging_count} aging)` : ""}`)}
    ${metricRow("Fulfilled", String(data.fulfilled_count))}
    ${data.autopilot.paused + data.autopilot.resumed > 0
      ? metricRow(
          "Autopilot actions",
          `${data.autopilot.paused} paused / ${data.autopilot.resumed} resumed`,
          data.autopilot.total_spend_affected > 0
            ? `<span style="color:#6b7280;font-weight:400;">(${formatPHP(data.autopilot.total_spend_affected)})</span>`
            : undefined
        )
      : ""}
    ${data.rts.rts_count > 0
      ? metricRow(
          "RTS",
          `${data.rts.rts_count} parcels`,
          `<span style="color:#6b7280;font-weight:400;">(${formatPHP(data.rts.rts_value)})</span>`
        )
      : ""}
  </table></td></tr>`);

  // Top products
  if (data.top_products.length > 0) {
    sections.push(sectionHeader("Top products"));
    sections.push(`<tr><td><table width="100%" role="presentation" cellpadding="0" cellspacing="0">
      ${data.top_products
        .map((p) =>
          listItem(
            p.product_title,
            `${p.store_name} · ${p.units_sold} units · ${formatPHP(p.revenue)}`
          )
        )
        .join("")}
    </table></td></tr>`);
  }

  // Top ads
  if (data.top_ads.length > 0) {
    sections.push(sectionHeader("Top ads"));
    sections.push(`<tr><td><table width="100%" role="presentation" cellpadding="0" cellspacing="0">
      ${data.top_ads
        .map((a) =>
          listItem(
            a.ad_name,
            `${formatPHP(a.spend)} spend · ${a.roas.toFixed(2)}x ROAS · ${a.purchases} purchases`
          )
        )
        .join("")}
    </table></td></tr>`);
  }

  if (data.worst_ads.length > 0) {
    sections.push(sectionHeader("Ads to review"));
    sections.push(`<tr><td><table width="100%" role="presentation" cellpadding="0" cellspacing="0">
      ${data.worst_ads
        .map((a) => listItem(a.ad_name, `${formatPHP(a.spend)} spend · 0 purchases`))
        .join("")}
    </table></td></tr>`);
  }

  // Stores
  if (data.store_breakdown.length > 0) {
    sections.push(sectionHeader("Stores"));
    sections.push(`<tr><td><table width="100%" role="presentation" cellpadding="0" cellspacing="0">
      ${data.store_breakdown
        .slice(0, 4)
        .map((s) =>
          listItem(
            s.store_name,
            `${formatPHP(s.revenue)} · ${s.orders} orders · ${s.unfulfilled} unfulfilled`
          )
        )
        .join("")}
    </table></td></tr>`);
  }

  // Team hours (weekly/monthly only — not useful on daily)
  if ((type === "weekly" || type === "monthly") && data.team_hours.length > 0) {
    sections.push(sectionHeader("Team hours"));
    sections.push(`<tr><td><table width="100%" role="presentation" cellpadding="0" cellspacing="0">
      ${data.team_hours.map((t) => metricRow(t.role, `${t.hours}h`)).join("")}
    </table></td></tr>`);
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(typeLabel[type])}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#fff;border-radius:12px;padding:28px;">
        <tr><td style="padding:0 0 18px 0;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:13px;font-weight:600;color:#111827;">Astrobiz</div>
        </td></tr>
        <tr><td style="padding:20px 0 0 0;"></td></tr>
        ${sections.join("")}
        <tr><td style="padding:24px 0 0 0;text-align:center;">
          <a href="${appUrl}/admin/briefings/${briefingId}" style="display:inline-block;padding:10px 20px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:500;">View full report →</a>
        </td></tr>
      </table>
      <p style="margin:20px 0 0 0;text-align:center;font-size:11px;color:#9ca3af;">
        Astrobiz scheduled briefings · <a href="${appUrl}/admin/briefings" style="color:#6b7280;">All briefings</a>
      </p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html };
}
