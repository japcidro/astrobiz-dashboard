import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  AD_COPY_PRESET_KINDS,
  type AdCopyPresetKind,
  type CreateAdCopyPresetInput,
} from "@/lib/ad-copy-presets/types";

export const dynamic = "force-dynamic";

// GET /api/ad-copy-presets?store_id=UUID[&kind=ad_name|primary_text|headline|description]
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store_id");
  const kind = searchParams.get("kind");

  if (!storeId) {
    return Response.json({ error: "store_id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  let query = supabase
    .from("ad_copy_presets")
    .select("*")
    .eq("shopify_store_id", storeId)
    .order("kind", { ascending: true })
    .order("label", { ascending: true });

  if (kind) {
    if (!AD_COPY_PRESET_KINDS.includes(kind as AdCopyPresetKind)) {
      return Response.json({ error: "Invalid kind" }, { status: 400 });
    }
    query = query.eq("kind", kind);
  }

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ presets: data ?? [] });
}

// POST /api/ad-copy-presets — create a preset
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as CreateAdCopyPresetInput;
  const label = body.label?.trim() ?? "";
  const content = body.content ?? "";

  if (!body.shopify_store_id || !body.kind || !label || !content.trim()) {
    return Response.json(
      { error: "shopify_store_id, kind, label, and content are required" },
      { status: 400 }
    );
  }
  if (!AD_COPY_PRESET_KINDS.includes(body.kind)) {
    return Response.json({ error: "Invalid kind" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ad_copy_presets")
    .insert({
      shopify_store_id: body.shopify_store_id,
      kind: body.kind,
      label,
      content,
      created_by: employee.id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { error: `A preset named "${label}" already exists for this field.` },
        { status: 409 }
      );
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ preset: data });
}
