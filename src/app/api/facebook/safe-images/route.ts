import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Reusable "safe image" library for the Fix Rejections tab. These are the
// benign images (cats, etc.) that replace a rejected ad's creative so Meta
// re-approves the ad. FB image hashes are scoped per ad account, so we
// store the public FB CDN url here and re-mint per-account hashes lazily
// at fix time (see fix-rejection/route.ts). Uploading once gives us a
// public url + a first cached hash for whichever account we uploaded to.

// GET /api/facebook/safe-images → list active safe images
export async function GET() {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fix_rejection_safe_images")
    .select("id, name, source_url, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ images: data ?? [] });
}

// POST /api/facebook/safe-images
// Raw image bytes in the body. Metadata via headers (mirrors the
// create/upload route, which avoids multipart parsing on the server):
//   x-account-id  — ad account to upload into (act_…) to obtain a CDN url
//   x-file-name   — original filename
//   x-file-content-type — image mime type
//   x-name        — human label for the library
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const accountId = request.headers.get("x-account-id");
  const fileName = request.headers.get("x-file-name") || "safe-image";
  const contentType =
    request.headers.get("x-file-content-type") || "image/jpeg";
  const name = (request.headers.get("x-name") || "").trim() || fileName;

  if (!accountId) {
    return Response.json(
      { error: "Missing x-account-id header" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  if (!tokenSetting?.value) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }
  const token = tokenSetting.value as string;

  try {
    const fileBuffer = await request.arrayBuffer();
    if (!fileBuffer || fileBuffer.byteLength === 0) {
      return Response.json({ error: "No file data received" }, { status: 400 });
    }

    const blob = new Blob([fileBuffer], { type: contentType });
    const fbForm = new FormData();
    fbForm.append("access_token", token);
    fbForm.append("filename", blob, fileName);

    const res = await fetch(`${FB_API_BASE}/${accountId}/adimages`, {
      method: "POST",
      body: fbForm,
    });
    const resText = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(resText);
    } catch {
      throw new Error(`Invalid response from Facebook: ${resText.slice(0, 300)}`);
    }
    if (!res.ok) {
      const fbErr = json.error as Record<string, unknown> | undefined;
      throw new Error((fbErr?.message as string) || `FB API error: ${res.status}`);
    }

    const images = json.images as Record<string, { hash: string; url: string }>;
    const firstKey = Object.keys(images)[0];
    const { hash, url } = images[firstKey];

    const { data: row, error } = await supabase
      .from("fix_rejection_safe_images")
      .insert({
        name,
        source_url: url,
        account_hashes: { [accountId]: hash },
        created_by: employee.id,
      })
      .select("id, name, source_url, created_at")
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true, image: row });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/facebook/safe-images?id=UUID → soft-delete (active=false)
export async function DELETE(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase
    .from("fix_rejection_safe_images")
    .update({ active: false })
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
