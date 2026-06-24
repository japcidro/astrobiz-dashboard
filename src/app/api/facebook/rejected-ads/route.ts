import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { isNurseryCampaign } from "@/lib/facebook/nursery";

export const dynamic = "force-dynamic";
// Up to ~13 accounts queried in parallel, each paginating its ads.
export const maxDuration = 60;

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Statuses we treat as "needs fixing". DISAPPROVED = hard rejection;
// WITH_ISSUES = running but policy-flagged (limited delivery). Both clear via
// the same swap+re-review fix, so we surface both.
const REJECTED_STATUSES = ["DISAPPROVED", "WITH_ISSUES"];

interface AdNode {
  id: string;
  name?: string;
  effective_status?: string;
  campaign?: { id?: string; name?: string };
  adset?: { id?: string; name?: string };
}

// Paginate a FB edge, following paging.next, with a per-call timeout so one
// slow account can't hang the whole request.
async function fbPaginate(
  url: string,
  timeoutMs = 12000
): Promise<AdNode[]> {
  const out: AdNode[] = [];
  let next: string | null = url;
  while (next) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let json: { data?: AdNode[]; paging?: { next?: string }; error?: { message?: string } };
    try {
      const res = await fetch(next, { cache: "no-store", signal: controller.signal });
      json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || `FB API error: ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
    out.push(...(json.data ?? []));
    next = json.paging?.next ?? null;
  }
  return out;
}

// GET /api/facebook/rejected-ads
//
// Lists DISAPPROVED / WITH_ISSUES ads in NURSERY campaigns across the selected
// ad accounts. We query each account's /ads filtered by effective_status —
// this catches rejected ads even when their campaign/ad set is paused (the
// dashboard's all-ads view masks those as "CAMPAIGN PAUSED", which is why the
// Fix Rejections page only ever saw the handful in still-active parents).
export async function GET() {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  if (!tokenSetting?.value) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }
  const token = tokenSetting.value as string;

  const { data: selectedSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_selected_accounts")
    .single();
  let selectedAccountIds: string[] = [];
  try {
    selectedAccountIds = selectedSetting?.value ? JSON.parse(selectedSetting.value) : [];
  } catch {
    selectedAccountIds = [];
  }

  // 1. List ad accounts, then restrict to the settings-selected ones.
  let accounts: { id: string; name: string }[];
  try {
    const accRes = await fetch(
      `${FB_API_BASE}/me/adaccounts?fields=id,name&limit=100&access_token=${token}`,
      { cache: "no-store" }
    );
    const accJson = (await accRes.json()) as {
      data?: { id: string; name: string }[];
      error?: { message?: string };
    };
    if (!accRes.ok) throw new Error(accJson.error?.message || "Couldn't load ad accounts");
    accounts = accJson.data ?? [];
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Couldn't load ad accounts" },
      { status: 502 }
    );
  }
  if (selectedAccountIds.length > 0) {
    accounts = accounts.filter((a) => selectedAccountIds.includes(a.id));
  }

  // 2. For each account, fetch rejected ads (any pause state) + their campaign,
  //    keep only those in nursery campaigns. Per-account failures are logged
  //    and skipped rather than failing the whole list.
  const errors: string[] = [];
  const fields =
    "id,name,effective_status,campaign{id,name},adset{id,name}";
  const params = new URLSearchParams({
    fields,
    effective_status: JSON.stringify(REJECTED_STATUSES),
    limit: "500",
    access_token: token,
  });

  const perAccount = await Promise.all(
    accounts.map(async (acc) => {
      try {
        const ads = await fbPaginate(`${FB_API_BASE}/${acc.id}/ads?${params}`);
        return ads
          .filter((ad) => isNurseryCampaign(ad.campaign?.name))
          .map((ad) => ({
            ad_id: ad.id,
            account: acc.name,
            account_id: acc.id,
            campaign: ad.campaign?.name ?? "",
            campaign_id: ad.campaign?.id ?? "",
            adset: ad.adset?.name ?? "",
            adset_id: ad.adset?.id ?? "",
            ad: ad.name ?? "",
            status: ad.effective_status ?? "",
          }));
      } catch (e) {
        errors.push(`${acc.name}: ${e instanceof Error ? e.message : "failed"}`);
        return [];
      }
    })
  );

  const data = perAccount.flat();
  return Response.json({
    data,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    count: data.length,
    errors,
  });
}
