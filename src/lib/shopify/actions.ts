"use server";

import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { revalidatePath } from "next/cache";
import { normalizeStoreUrl } from "./store-url";
import { verifyShopifyToken } from "./verify-token";

export async function addShopifyStore(formData: FormData) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return { error: "Unauthorized" };
  }

  const name = formData.get("name") as string;
  const store_url = normalizeStoreUrl((formData.get("store_url") as string) ?? "");
  const client_id = formData.get("client_id") as string;
  const client_secret = formData.get("client_secret") as string;
  const api_token = ((formData.get("api_token") as string) ?? "").trim();

  if (!name || !store_url) {
    return { error: "Name and store URL are required" };
  }

  // Two ways in. Pasting an Admin API access token connects the store
  // outright; OAuth only exists to go and fetch one of those tokens.
  if (api_token) {
    const check = await verifyShopifyToken(store_url, api_token);
    if (!check.ok) return { error: check.error };
  } else if (!client_id || !client_secret) {
    return {
      error:
        "Paste an Admin API access token, or give a Client ID and Client Secret to connect over OAuth",
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("shopify_stores")
    .insert({
      name,
      store_url,
      client_id: client_id || null,
      client_secret: client_secret || null,
      api_token: api_token || null, // OAuth fills this in on callback
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/settings");
  return { success: true, store_id: data.id, connected: Boolean(api_token) };
}

export async function updateShopifyStore(id: string, formData: FormData) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return { error: "Unauthorized" };
  }

  const name = formData.get("name") as string;
  const store_url = normalizeStoreUrl((formData.get("store_url") as string) ?? "");
  const client_id = formData.get("client_id") as string;
  const client_secret = formData.get("client_secret") as string;
  const api_token = ((formData.get("api_token") as string) ?? "").trim();

  if (!name || !store_url) {
    return { error: "Name and store URL are required" };
  }

  if (api_token) {
    const check = await verifyShopifyToken(store_url, api_token);
    if (!check.ok) return { error: check.error };
  }

  const updates: Record<string, string | null> = { name, store_url };
  if (client_id) updates.client_id = client_id;
  if (client_secret) updates.client_secret = client_secret;
  if (api_token) updates.api_token = api_token;

  const supabase = await createClient();

  const { error } = await supabase
    .from("shopify_stores")
    .update(updates)
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/settings");
  return { success: true, connected: Boolean(api_token) };
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
