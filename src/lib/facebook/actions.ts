"use server";

import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { revalidatePath } from "next/cache";

export async function saveFBSettings(formData: FormData) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    throw new Error("Unauthorized");
  }

  const token = formData.get("fb_token") as string;
  const adAccountId = formData.get("fb_ad_account_id") as string;

  if (!token || !adAccountId) {
    throw new Error("Token and Ad Account ID are required");
  }

  const supabase = await createClient();

  // Upsert token
  const { error: tokenError } = await supabase.from("app_settings").upsert(
    {
      key: "fb_access_token",
      value: token,
      updated_by: employee.id,
    },
    { onConflict: "key" }
  );

  if (tokenError) throw new Error(tokenError.message);

  // Upsert ad account id
  const { error: accountError } = await supabase.from("app_settings").upsert(
    {
      key: "fb_ad_account_id",
      value: adAccountId,
      updated_by: employee.id,
    },
    { onConflict: "key" }
  );

  if (accountError) throw new Error(accountError.message);

  revalidatePath("/admin/settings");
  revalidatePath("/marketing/ads");
}

export async function saveSelectedAccounts(accountIds: string[]) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    throw new Error("Unauthorized");
  }

  const supabase = await createClient();

  const { error } = await supabase.from("app_settings").upsert(
    {
      key: "fb_selected_accounts",
      value: JSON.stringify(accountIds),
      updated_by: employee.id,
    },
    { onConflict: "key" }
  );

  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePath("/marketing/ads");
}
