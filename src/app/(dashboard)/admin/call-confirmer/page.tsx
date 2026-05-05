import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { CallConfirmerClient } from "./CallConfirmerClient";
import type {
  CallConfirmerConfig,
  ShopifyStoreLite,
} from "@/lib/call-confirmer/types";

export const dynamic = "force-dynamic";

export default async function CallConfirmerPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();

  const [storesRes, configsRes] = await Promise.all([
    supabase
      .from("shopify_stores")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    supabase.from("call_confirmer_configs").select("*"),
  ]);

  const stores: ShopifyStoreLite[] = storesRes.data ?? [];
  const configs: CallConfirmerConfig[] = configsRes.data ?? [];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">AI Call Confirmer</h1>
        <p className="text-sm text-gray-500">
          Confirm orders sa pamamagitan ng AI phone calls. Manual select muna v1
          — pumili ng leads, AI tatawag, transcript + outcome auto-saved.
        </p>
      </div>

      <CallConfirmerClient
        initialStores={stores}
        initialConfigs={configs}
        employeeId={employee.id}
      />
    </div>
  );
}
