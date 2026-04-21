"use server";

import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

async function requireMarketing() {
  const employee = await getEmployee();
  if (!employee) throw new Error("Unauthorized");
  if (!["admin", "marketing"].includes(employee.role)) {
    throw new Error("Forbidden");
  }
  return employee;
}

export async function addMoodboardImage(
  storeName: string,
  imageUrl: string,
  label?: string
): Promise<string> {
  const employee = await requireMarketing();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("moodboard_images")
    .insert({
      store_name: storeName,
      image_url: imageUrl,
      label: label || null,
      created_by: employee.auth_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function deleteMoodboardImage(id: string) {
  await requireMarketing();
  const supabase = await createClient();
  const { error } = await supabase.from("moodboard_images").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function addProductPhoto(
  storeName: string,
  productName: string,
  imageUrl: string
): Promise<string> {
  const employee = await requireMarketing();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_photos")
    .insert({
      store_name: storeName,
      product_name: productName,
      image_url: imageUrl,
      created_by: employee.auth_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function deleteProductPhoto(id: string) {
  await requireMarketing();
  const supabase = await createClient();
  const { error } = await supabase.from("product_photos").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function saveGeneratedImage(
  storeName: string,
  imageUrl: string,
  prompt: string,
  outputType: string,
  moodboardIds: string[],
  productPhotoIds: string[]
): Promise<string> {
  const employee = await requireMarketing();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("generated_images")
    .insert({
      store_name: storeName,
      image_url: imageUrl,
      prompt,
      output_type: outputType,
      moodboard_ids: moodboardIds,
      product_photo_ids: productPhotoIds,
      created_by: employee.auth_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function deleteGeneratedImage(id: string) {
  await requireMarketing();
  const supabase = await createClient();
  const { error } = await supabase.from("generated_images").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function rateGeneratedImage(id: string, rating: number) {
  await requireMarketing();
  const supabase = await createClient();
  const { error } = await supabase
    .from("generated_images")
    .update({ rating })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
