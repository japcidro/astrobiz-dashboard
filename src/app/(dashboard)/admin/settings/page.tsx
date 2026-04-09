import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { TokenManager } from "@/components/marketing/token-manager";

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

interface DetectedAccount {
  id: string;
  name: string;
  account_id: string;
  account_status: number;
  status_label: string;
  is_active: boolean;
}

export default async function SettingsPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();

  const [{ data: tokenSetting }, { data: selectedSetting }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", "fb_access_token")
      .single(),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_selected_accounts")
      .single(),
  ]);

  const token = tokenSetting?.value || "";
  let selectedAccountIds: string[] = [];
  try {
    selectedAccountIds = selectedSetting?.value ? JSON.parse(selectedSetting.value) : [];
  } catch {
    selectedAccountIds = [];
  }

  // Auto-fetch accounts if token exists
  let detectedAccounts: DetectedAccount[] = [];
  let fetchError: string | null = null;

  if (token) {
    try {
      const res = await fetch(
        `${FB_API_BASE}/me/adaccounts?fields=id,name,account_id,account_status&limit=100&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (data.error) {
        fetchError = data.error.message;
      } else {
        detectedAccounts = (data.data || []).map(
          (a: { id: string; name: string; account_id: string; account_status: number }) => ({
            id: a.id,
            name: a.name,
            account_id: a.account_id,
            account_status: a.account_status,
            status_label: ACCOUNT_STATUS_MAP[a.account_status] || "UNKNOWN",
            is_active: a.account_status === 1,
          })
        );
      }
    } catch {
      fetchError = "Failed to connect to Facebook API";
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 mt-1">Manage integrations and tokens</p>
      </div>

      <TokenManager
        currentToken={token}
        tokenUpdatedAt={tokenSetting?.updated_at || null}
        detectedAccounts={detectedAccounts}
        fetchError={fetchError}
        selectedAccountIds={selectedAccountIds}
      />
    </div>
  );
}
