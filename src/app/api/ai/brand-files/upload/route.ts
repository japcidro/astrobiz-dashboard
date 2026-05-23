import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { resolveFileType, extractText } from "@/lib/ai/file-extractors";
import { BRAND_FILE_CATEGORIES, type BrandFileCategory } from "@/lib/ai/brand-types";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const file = form.get("file");
  const storeName = form.get("store_name");
  const category = form.get("category");
  const titleRaw = form.get("title");

  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }
  if (typeof storeName !== "string" || !storeName) {
    return Response.json({ error: "store_name is required" }, { status: 400 });
  }
  if (
    typeof category !== "string" ||
    !BRAND_FILE_CATEGORIES.includes(category as BrandFileCategory)
  ) {
    return Response.json(
      { error: `category must be one of: ${BRAND_FILE_CATEGORIES.join(", ")}` },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json(
      { error: `File too large (max ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB)` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Resolve type from the bytes (magic-byte sniff), falling back to the
  // filename only for the md-vs-txt distinction. A .docx-named file that
  // is actually plain markdown will be reclassified here.
  const resolved = resolveFileType(buffer, file.name);
  if (!resolved.ok) {
    return Response.json({ error: resolved.error }, { status: 400 });
  }
  const fileType = resolved.type;

  let extractedText: string;
  try {
    extractedText = await extractText(buffer, fileType);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown extraction error";
    return Response.json(
      { error: `Failed to extract text: ${message}` },
      { status: 422 }
    );
  }

  if (!extractedText.trim()) {
    return Response.json(
      { error: "File appears to be empty or unreadable" },
      { status: 422 }
    );
  }

  const supabase = await createClient();

  // Upload to Storage. Path is scoped per store to make per-brand listing easy.
  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${storeName}/${crypto.randomUUID()}-${safeFileName}`;
  const uploadRes = await supabase.storage
    .from("brand-files")
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadRes.error) {
    return Response.json(
      { error: `Storage upload failed: ${uploadRes.error.message}` },
      { status: 500 }
    );
  }

  const title =
    typeof titleRaw === "string" && titleRaw.trim()
      ? titleRaw.trim()
      : file.name.replace(/\.[^.]+$/, "");

  const insertRes = await supabase
    .from("brand_reference_files")
    .insert({
      store_name: storeName,
      title,
      category,
      file_url: storagePath,
      file_name: file.name,
      file_type: fileType,
      extracted_text: extractedText,
      file_size_bytes: file.size,
      created_by: employee.id,
    })
    .select("*")
    .single();

  if (insertRes.error) {
    // Best-effort cleanup of the orphaned blob.
    await supabase.storage.from("brand-files").remove([storagePath]);
    return Response.json(
      { error: `DB insert failed: ${insertRes.error.message}` },
      { status: 500 }
    );
  }

  return Response.json({ file: insertRes.data });
}
