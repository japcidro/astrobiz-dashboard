"use server";

import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { revalidatePath } from "next/cache";

export async function addShopifyStore(formData: FormData) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return { error: "Unauthorized" };
  }

  const name = formData.get("name") as string;
  const store_url = formData.get("store_url") as string;
  const client_id = formData.get("client_id") as string;
  const client_secret = formData.get("client_secret") as string;

  if (!name || !store_url || !client_id || !client_secret) {
    return { error: "Name, store URL, Client ID, and Client Secret are required" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("shopify_stores")
    .insert({
      name,
      store_url,
      client_id,
      client_secret,
      api_token: null, // will be filled after OAuth
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/settings");
  return { success: true, store_id: data.id };
}

export async function updateShopifyStore(id: string, formData: FormData) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return { error: "Unauthorized" };
  }

  const name = formData.get("name") as string;
  const store_url = formData.get("store_url") as string;
  const client_id = formData.get("client_id") as string;
  const client_secret = formData.get("client_secret") as string;

  if (!name || !store_url) {
    return { error: "Name and store URL are required" };
  }

  const updates: Record<string, string | null> = { name, store_url };
  if (client_id) updates.client_id = client_id;
  if (client_secret) updates.client_secret = client_secret;

  const supabase = await createClient();

  const { error } = await supabase
    .from("shopify_stores")
    .update(updates)
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/settings");
  return { success: true };
}

export async function deleteShopifyStore(id: string) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return { error: "Unauthorized" };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("shopify_stores")
    .delete()
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/settings");
  return { success: true };
}

export async function toggleShopifyStore(id: string, isActive: boolean) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return { error: "Unauthorized" };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("shopify_stores")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/settings");
  return { success: true };
}
