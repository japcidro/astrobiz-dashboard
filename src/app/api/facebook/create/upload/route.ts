import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Read metadata from headers instead of FormData
  const accountId = request.headers.get("x-account-id");
  const uploadType = request.headers.get("x-upload-type") as
    | "image"
    | "video"
    | null;
  const fileName = request.headers.get("x-file-name") || "upload";
  const contentType =
    request.headers.get("x-file-content-type") || "application/octet-stream";

  if (!accountId || !uploadType) {
    return Response.json(
      { error: "Missing x-account-id or x-upload-type headers" },
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
    return Response.json({ error: "Token not configured" }, { status: 400 });
  }

  const token = tokenSetting.value;

  try {
    // Read file bytes from request body
    const fileBuffer = await request.arrayBuffer();

    if (!fileBuffer || fileBuffer.byteLength === 0) {
      return Response.json({ error: "No file data received" }, { status: 400 });
    }

    const blob = new Blob([fileBuffer], { type: contentType });

    // Build FormData for FB API
    const fbForm = new FormData();
    fbForm.append("access_token", token);

    if (uploadType === "image") {
      fbForm.append("filename", blob, fileName);

      const res = await fetch(`${FB_API_BASE}/${accountId}/adimages`, {
        method: "POST",
        body: fbForm,
      });

      const resText = await res.text();
      if (!resText) throw new Error("Empty response from Facebook API");

      let json: Record<string, unknown>;
      try {
        json = JSON.parse(resText);
      } catch {
        throw new Error(
          `Invalid response from Facebook: ${resText.slice(0, 300)}`
        );
      }

      if (!res.ok) {
        const fbErr = json.error as Record<string, unknown> | undefined;
        throw new Error(
          (fbErr?.message as string) || `FB API error: ${res.status}`
        );
      }

      const images = json.images as Record<
        string,
        { hash: string; url: string }
      >;
      const firstKey = Object.keys(images)[0];
      const imageData = images[firstKey];

      return Response.json({
        success: true,
        type: "image",
        image_hash: imageData.hash,
        url: imageData.url,
      });
    }

    if (uploadType === "video") {
      fbForm.append("source", blob, fileName);
      fbForm.append("title", fileName);

      const res = await fetch(`${FB_API_BASE}/${accountId}/advideos`, {
        method: "POST",
        body: fbForm,
      });

      const resText = await res.text();
      if (!resText) throw new Error("Empty response from Facebook API");

      let json: Record<string, unknown>;
      try {
        json = JSON.parse(resText);
      } catch {
        throw new Error(
          `Invalid response from Facebook: ${resText.slice(0, 300)}`
        );
      }

      if (!res.ok) {
        const fbErr = json.error as Record<string, unknown> | undefined;
        throw new Error(
          (fbErr?.message as string) || `FB API error: ${res.status}`
        );
      }

      return Response.json({
        success: true,
        type: "video",
        video_id: json.id,
      });
    }

    return Response.json({ error: "Invalid type" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
