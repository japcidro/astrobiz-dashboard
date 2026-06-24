import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  generateEngagementCopy,
  FIX_REJECTION_COPY_MODEL,
} from "@/lib/ai/fix-rejection-copy";

export const dynamic = "force-dynamic";
// Upload to FB + a Claude vision call to write copy.
export const maxDuration = 60;

const FB_API_BASE = "https://graph.facebook.com/v21.0";

const SAFE_IMAGE_FIELDS =
  "id, name, source_url, ai_headline, ai_primary_text, ai_description, ai_cta, ai_model, ai_generated_at, created_at";

// Reusable "safe image" library for the Fix Rejections tab. These are the
// benign images (cats, etc.) that replace a rejected ad's creative so Meta
// re-approves the ad. FB image hashes are scoped per ad account, so we
// store the public FB CDN url here and re-mint per-account hashes lazily
// at fix time (see fix-rejection/route.ts). On upload, Claude (vision)
// reads the image and writes engagement copy once, cached on the row.

async function getAnthropicKey(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .single();
  return (data?.value as string | undefined) ?? null;
}

// GET /api/facebook/safe-images → list active safe images (+ AI copy)
export async function GET() {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fix_rejection_safe_images")
    .select(SAFE_IMAGE_FIELDS)
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

    // The CDN `url` FB returns here is signed and EXPIRES after ~weeks, which
    // is why old library thumbnails go blank. Fetch the image's stable
    // `permalink_url` (a non-expiring facebook.com/ads/image link that serves
    // the bytes directly) and store THAT as source_url. Fall back to the CDN
    // url if the lookup fails.
    let sourceUrl = url;
    try {
      const permaRes = await fetch(
        `${FB_API_BASE}/${accountId}/adimages?hashes=${encodeURIComponent(
          JSON.stringify([hash])
        )}&fields=permalink_url&access_token=${token}`,
        { cache: "no-store" }
      );
      const permaJson = (await permaRes.json()) as {
        data?: { permalink_url?: string }[];
      };
      const permalink = permaJson.data?.[0]?.permalink_url;
      if (permalink) sourceUrl = permalink;
    } catch {
      /* keep CDN url fallback */
    }

    // Have Claude read the image and write engagement copy (best-effort).
    let aiFields: Record<string, unknown> = {};
    const apiKey = await getAnthropicKey(supabase);
    if (apiKey) {
      const base64 = Buffer.from(fileBuffer).toString("base64");
      const copy = await generateEngagementCopy(base64, contentType, apiKey);
      if (copy) {
        aiFields = {
          ai_headline: copy.headline,
          ai_primary_text: copy.primary_text,
          ai_description: copy.description,
          ai_cta: copy.cta,
          ai_model: FIX_REJECTION_COPY_MODEL,
          ai_generated_at: new Date().toISOString(),
        };
      }
    }

    const { data: row, error } = await supabase
      .from("fix_rejection_safe_images")
      .insert({
        name,
        source_url: sourceUrl,
        account_hashes: { [accountId]: hash },
        created_by: employee.id,
        ...aiFields,
      })
      .select(SAFE_IMAGE_FIELDS)
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({
      success: true,
      image: row,
      ai_generated: Object.keys(aiFields).length > 0,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/facebook/safe-images
//   body { id, copy: { headline, primary_text, description, cta } }
//       → save manual copy edits (no AI call)
//   body { id }  → re-run AI copy generation (fetches the stored CDN image)
export async function PATCH(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    id?: string;
    copy?: {
      headline?: string;
      primary_text?: string;
      description?: string;
      cta?: string;
    };
  };
  if (!body.id) return Response.json({ error: "id required" }, { status: 400 });

  const supabase = await createClient();

  // Manual save path — no AI call.
  if (body.copy) {
    const headline = (body.copy.headline ?? "").trim();
    if (!headline) {
      return Response.json({ error: "headline required" }, { status: 400 });
    }
    const { data: row, error } = await supabase
      .from("fix_rejection_safe_images")
      .update({
        ai_headline: headline,
        ai_primary_text: (body.copy.primary_text ?? "").trim(),
        ai_description: (body.copy.description ?? "").trim(),
        ai_cta: (body.copy.cta ?? "LEARN_MORE").trim(),
        ai_generated_at: new Date().toISOString(),
      })
      .eq("id", body.id)
      .eq("active", true)
      .select(SAFE_IMAGE_FIELDS)
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true, image: row });
  }

  const { data: existing } = await supabase
    .from("fix_rejection_safe_images")
    .select("id, source_url")
    .eq("id", body.id)
    .eq("active", true)
    .maybeSingle<{ id: string; source_url: string }>();
  if (!existing) return Response.json({ error: "Image not found" }, { status: 404 });

  const apiKey = await getAnthropicKey(supabase);
  if (!apiKey) {
    return Response.json(
      { error: "Anthropic API key not configured. Go to Settings." },
      { status: 400 }
    );
  }

  try {
    const imgRes = await fetch(existing.source_url);
    if (!imgRes.ok) throw new Error(`couldn't fetch image (${imgRes.status})`);
    const mediaType = imgRes.headers.get("content-type") || "image/jpeg";
    const base64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");

    const copy = await generateEngagementCopy(base64, mediaType, apiKey);
    if (!copy) {
      return Response.json(
        { error: "AI couldn't generate copy for this image. Try again." },
        { status: 502 }
      );
    }

    const { data: row, error } = await supabase
      .from("fix_rejection_safe_images")
      .update({
        ai_headline: copy.headline,
        ai_primary_text: copy.primary_text,
        ai_description: copy.description,
        ai_cta: copy.cta,
        ai_model: FIX_REJECTION_COPY_MODEL,
        ai_generated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select(SAFE_IMAGE_FIELDS)
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true, image: row });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Regenerate failed";
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
