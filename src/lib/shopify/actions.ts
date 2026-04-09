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
  const api_token = formData.get("api_token") as string;

  if (!name || !store_url || !api_token) {
    return { error: "Name, store URL, and API token are required" };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("shopify_stores").insert({
    name,
    store_url,
    api_token,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/settings");
  return { success: true };
}

export async function updateShopifyStore(id: string, formData: FormData) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return { error: "Unauthorized" };
  }

  const name = formData.get("name") as string;
  const store_url = formData.get("store_url") as string;
  const api_token = formData.get("api_token") as string;

  if (!name || !store_url || !api_token) {
    return { error: "Name, store URL, and API token are required" };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("shopify_stores")
    .update({
      name,
      store_url,
      api_token,
    })
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

export async function testShopifyConnection(
  storeUrl: string,
  apiToken: string
) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return { error: "Unauthorized" };
  }

  if (!storeUrl || !apiToken) {
    return { error: "Store URL and API token are required" };
  }

  try {
    const response = await fetch(
      `https://${storeUrl}/admin/api/2024-01/shop.json`,
      {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": apiToken,
        },
      }
    );

    if (!response.ok) {
      return { error: `Shopify API returned ${response.status}: ${response.statusText}` };
    }

    const data = await response.json();
    return { success: true, shop_name: data.shop.name };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to connect to Shopify",
    };
  }
}
