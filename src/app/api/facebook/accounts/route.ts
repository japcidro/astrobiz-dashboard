import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

const ACCOUNT_STATUS_MAP: Record<number, string> = {
  1: "ACTIVE",
  2: "DISABLED",
  3: "UNSETTLED",
  7: "PENDING_REVIEW",
  8: "PENDING_SETTLEMENT",
  9: "GRACE_PERIOD",
  100: "PENDING_CLOSURE",
  101: "CLOSED",
};

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  // Allow passing a token directly for testing before saving
  let token = searchParams.get("token");

  const supabase = await createClient();

  if (!token) {
    const { data: tokenSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single();
    token = tokenSetting?.value || null;
  }

  if (!token) {
    return Response.json({ error: "No token provided" }, { status: 400 });
  }

  // Get selected accounts filter
  const { data: selectedSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_selected_accounts")
    .single();

  let selectedAccountIds: string[] = [];
  try {
    selectedAccountIds = selectedSetting?.value
      ? JSON.parse(selectedSetting.value)
      : [];
  } catch {
    selectedAccountIds = [];
  }

  try {
    const res = await fetch(
      `${FB_API_BASE}/me/adaccounts?fields=id,name,account_id,account_status&limit=100&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );

    const data = await res.json();

    if (data.error) {
      return Response.json({ error: data.error.message }, { status: 400 });
    }

    const allAccounts = (data.data || []).map(
      (a: { id: string; name: string; account_id: string; account_status: number }) => ({
        id: a.id,
        name: a.name,
        account_id: a.account_id,
        status: ACCOUNT_STATUS_MAP[a.account_status] || "UNKNOWN",
        is_active: a.account_status === 1,
      })
    );

    // Apply settings-level filter
    const accounts =
      selectedAccountIds.length > 0
        ? allAccounts.filter((a: { id: string }) =>
            selectedAccountIds.includes(a.id)
          )
        : allAccounts;

    return Response.json({ accounts });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to fetch accounts" },
      { status: 500 }
    );
  }
}
