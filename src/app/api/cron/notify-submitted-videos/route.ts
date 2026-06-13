import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/resend";
import { getAdminEmails } from "@/lib/email/admin-recipients";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FB_API_BASE = "https://graph.facebook.com/v21.0";
const LOOKBACK_DAYS = 3;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

interface RawAd {
  id: string;
  name: string;
  created_time?: string;
  effective_status?: string;
  creative?: {
    video_id?: string;
    object_story_spec?: { video_data?: { video_id?: string } };
  };
}

// Marketer attribution from the ad-name prefix (LIN→Linette, JO→Jhoanna),
// mirroring the Submitted Videos screen.
function attributeMarketer(adName: string): { code: string | null; name: string } {
  const re = /(LIN|JO)\d*/gi;
  const m = re.exec(adName);
  const code = m ? m[1].toUpperCase() : null;
  const name = code === "LIN" ? "Linette" : code === "JO" ? "Jhoanna" : "Unknown";
  return { code, name };
}

async function fetchAccountAds(
  accountId: string,
  token: string,
  sinceUnix: number
): Promise<RawAd[]> {
  const fields =
    "id,name,created_time,effective_status,creative{video_id,object_story_spec}";
  const filtering = JSON.stringify([
    { field: "ad.created_time", operator: "GREATER_THAN", value: sinceUnix },
  ]);
  let url =
    `${FB_API_BASE}/${accountId}/ads?` +
    new URLSearchParams({
      access_token: token,
      fields,
      filtering,
      limit: String(PAGE_SIZE),
    }).toString();

  const out: RawAd[] = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) break;
    out.push(...((json.data ?? []) as RawAd[]));
    url = (json.paging?.next as string) ?? "";
  }
  return out;
}

// Cron (every 30 min): email the CEO when marketers submit new ad videos so
// they're easy to review on the Submitted Videos screen. Dedupes against
// submitted_video_notifications; bootstraps silently on first run so it
// doesn't email the entire backlog.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: tokenRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  const token = tokenRow?.value as string | undefined;
  if (!token) return Response.json({ error: "Facebook token not configured" }, { status: 400 });

  // Which accounts to scan.
  const { data: selRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_selected_accounts")
    .single();
  let accountIds: string[] = [];
  try {
    accountIds = selRow?.value ? JSON.parse(selRow.value as string) : [];
  } catch {
    accountIds = [];
  }
  if (accountIds.length === 0) {
    const res = await fetch(
      `${FB_API_BASE}/me/adaccounts?fields=id&limit=100&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const json = await res.json();
    if (res.ok) {
      accountIds = ((json.data ?? []) as { id: string }[]).map((a) => a.id);
    }
  }

  const sinceUnix = Math.floor((Date.now() - LOOKBACK_DAYS * 86400 * 1000) / 1000);

  // Gather marketer-submitted ads across accounts.
  const candidates: {
    fb_ad_id: string;
    ad_name: string;
    marketer_name: string;
    created_time: string | null;
  }[] = [];
  for (const acc of accountIds) {
    const ads = await fetchAccountAds(acc, token, sinceUnix);
    for (const ad of ads) {
      const { code, name } = attributeMarketer(ad.name);
      if (!code) continue; // only marketer submissions (LIN/JO)
      candidates.push({
        fb_ad_id: ad.id,
        ad_name: ad.name,
        marketer_name: name,
        created_time: ad.created_time ?? null,
      });
    }
  }

  // Only email ads created recently (this window must comfortably exceed the
  // 30-min cron cadence so nothing slips through between runs). This also
  // means a fresh deploy never blasts the old backlog — only genuinely new
  // submissions qualify. The ledger then dedupes across runs.
  const EMAIL_WINDOW_MS = 150 * 60 * 1000; // 2.5h
  const cutoff = Date.now() - EMAIL_WINDOW_MS;
  const recent = candidates.filter(
    (c) => c.created_time && new Date(c.created_time).getTime() >= cutoff
  );
  if (recent.length === 0) {
    return Response.json({ ok: true, new: 0, note: "no new marketer ads" });
  }

  // Drop any we've already emailed about.
  const { data: seenRows } = await supabase
    .from("submitted_video_notifications")
    .select("fb_ad_id")
    .in(
      "fb_ad_id",
      recent.map((c) => c.fb_ad_id)
    );
  const seen = new Set((seenRows ?? []).map((r) => r.fb_ad_id as string));
  const fresh = recent.filter((c) => !seen.has(c.fb_ad_id));

  if (fresh.length === 0) {
    return Response.json({ ok: true, new: 0 });
  }

  // Build + send the email.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const link = `${appUrl}/marketing/submitted`;
  const rows = fresh
    .map(
      (c) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${c.ad_name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${c.marketer_name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;">${
          c.created_time ? new Date(c.created_time).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "—"
        }</td>
      </tr>`
    )
    .join("");
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;">
      <h2 style="margin:0 0 8px;">🎬 ${fresh.length} new ad${fresh.length > 1 ? "s" : ""} to review</h2>
      <p style="color:#444;margin:0 0 16px;">Your marketers submitted new ad videos. Review them on the Submitted Videos screen.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#888;font-size:12px;text-transform:uppercase;">
            <th style="padding:6px 10px;">Ad</th>
            <th style="padding:6px 10px;">Marketer</th>
            <th style="padding:6px 10px;">Submitted</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:18px 0;">
        <a href="${link}" style="background:#059669;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;">Review now →</a>
      </p>
    </div>`;

  const to = await getAdminEmails(supabase);
  const sent = await sendEmail({
    to,
    subject: `🎬 ${fresh.length} new ad${fresh.length > 1 ? "s" : ""} to review from your marketers`,
    html,
  });

  // Only mark as notified if the email actually went out, so a transient
  // email failure retries on the next run instead of silently swallowing.
  if (sent.ok) {
    await supabase.from("submitted_video_notifications").upsert(
      fresh.map((c) => ({
        fb_ad_id: c.fb_ad_id,
        ad_name: c.ad_name,
        marketer_name: c.marketer_name,
        created_time: c.created_time,
      })),
      { onConflict: "fb_ad_id" }
    );
  }

  return Response.json({
    ok: sent.ok,
    new: fresh.length,
    emailed_to: to.length,
    email_error: sent.ok ? undefined : sent.error,
  });
}
