import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Lists all active campaigns across all ad accounts so the admin can
// pick which is the "scaling" campaign per store. Returns shape:
// { campaigns: [{ id, name, account_id, account_name }] }
export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: tokenRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  const token = (tokenRow?.value as string | undefined) ?? "";
  if (!token) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }

  const { data: selectedRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_selected_accounts")
    .single();
  let selectedIds: string[] = [];
  try {
    selectedIds = selectedRow?.value
      ? JSON.parse(selectedRow.value as string)
      : [];
  } catch {
    selectedIds = [];
  }

  try {
    const accountsRes = await fetch(
      `${FB_API_BASE}/me/adaccounts?fields=id,name,account_status&limit=100&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const accountsJson = await accountsRes.json();
    if (!accountsRes.ok) {
      throw new Error(
        accountsJson?.error?.message ?? `FB error ${accountsRes.status}`
      );
    }
    const allAccounts: Array<{
      id: string;
      name: string;
      account_status: number;
    }> = accountsJson.data ?? [];

    const accounts = allAccounts.filter((a) => {
      if (a.account_status !== 1) return false;
      return selectedIds.length === 0 || selectedIds.includes(a.id);
    });

    const campaigns: Array<{
      id: string;
      name: string;
      account_id: string;
      account_name: string;
      status: string;
    }> = [];

    await Promise.all(
      accounts.map(async (acct) => {
        try {
          const res = await fetch(
            `${FB_API_BASE}/${acct.id}/campaigns?fields=id,name,effective_status&limit=200&access_token=${encodeURIComponent(token)}`,
            { cache: "no-store" }
          );
          const json = await res.json();
          if (!res.ok) return;
          for (const c of (json.data ?? []) as Array<{
            id: string;
            name: string;
            effective_status: string;
          }>) {
            // Include ACTIVE + PAUSED so admin can pick either
            // (a paused campaign is still a valid long-lived target).
            if (
              c.effective_status === "ACTIVE" ||
              c.effective_status === "PAUSED"
            ) {
              campaigns.push({
                id: c.id,
                name: c.name,
                account_id: acct.id,
                account_name: acct.name,
                status: c.effective_status,
              });
            }
          }
        } catch {
          // skip account on error
        }
      })
    );

    campaigns.sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ campaigns });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "FB fetch failed" },
      { status: 502 }
    );
  }
}
