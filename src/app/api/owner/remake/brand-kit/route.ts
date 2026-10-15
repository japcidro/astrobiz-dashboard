import { requireBoardUser } from "@/lib/marketing-board/auth";
import { BOARD_BUCKET } from "@/lib/marketing-board/storage";
import { PRODUCT_FORMS, type ProductForm } from "@/lib/remake/types";
import { isUuid, labelBrandImage, loadBrandKit } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

const storeOf = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);

/** GET ?store= — the store's product photos and rules. */
export async function GET(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const store = storeOf(new URL(request.url).searchParams.get("store"));
  if (!store) return Response.json({ error: "Missing store" }, { status: 400 });
  return Response.json({ kit: await loadBrandKit(auth.db, store) });
}

/** PUT { store, rules? , relabel? } — save the rules, and/or label photos that have no form yet. */
export async function PUT(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { store?: unknown; rules?: unknown; profile?: unknown; relabel?: unknown } | null;
  const store = storeOf(b?.store);
  if (!store) return Response.json({ error: "Missing store" }, { status: 400 });
  if (typeof b?.rules === "string") {
    const rules = b.rules.trim().slice(0, 1500);
    const { error } = await auth.db.from("remake_brand_kits").upsert({ store, rules, updated_by: auth.employee.id, updated_at: new Date().toISOString() }, { onConflict: "store" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  if (typeof b?.profile === "string") {
    const profile = b.profile.trim().slice(0, 6000);
    const { error } = await auth.db.from("remake_brand_kits").upsert({ store, profile, updated_by: auth.employee.id, updated_at: new Date().toISOString() }, { onConflict: "store" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  if (b?.relabel === true) {
    const { data: imgs } = await auth.db.from("remake_brand_images").select("id, path").eq("store", store).is("kind", null);
    for (const img of (imgs ?? []) as Array<{ id: string; path: string }>) await labelBrandImage(auth.db, img.id, img.path).catch(() => {});
  }
  return Response.json({ kit: await loadBrandKit(auth.db, store) });
}

/** POST { store, path, label? } — register a product photo uploaded via /upload-url. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { store?: unknown; path?: unknown; label?: unknown } | null;
  const store = storeOf(b?.store);
  if (!store) return Response.json({ error: "Missing store" }, { status: 400 });
  const path = typeof b?.path === "string" ? b.path : "";
  if (!/^brand\/[^/]+\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(path)) return Response.json({ error: "Upload the photo first" }, { status: 400 });
  const { data: row, error } = await auth.db
    .from("remake_brand_images")
    .insert({ store, path, label: typeof b?.label === "string" ? b.label.slice(0, 80) : null })
    .select("id")
    .single();
  if (error || !row) return Response.json({ error: error?.message ?? "Could not save" }, { status: 500 });
  // Claude labels the form (bottle, gummies…) so the still swap can match it; the owner can correct it.
  await labelBrandImage(auth.db, row.id as string, path).catch(() => {});
  return Response.json({ kit: await loadBrandKit(auth.db, store) });
}

/** PATCH { id, kind?, description? } — correct a product photo's label. */
export async function PATCH(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { id?: unknown; kind?: unknown; description?: unknown } | null;
  if (!isUuid(b?.id)) return Response.json({ error: "Missing id" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof b?.kind === "string" && (PRODUCT_FORMS as string[]).includes(b.kind)) patch.kind = b.kind as ProductForm;
  if (typeof b?.description === "string") patch.description = b.description.trim().slice(0, 160) || null;
  if (Object.keys(patch).length === 0) return Response.json({ error: "Nothing to change" }, { status: 400 });
  const { data: img, error } = await auth.db.from("remake_brand_images").update(patch).eq("id", b!.id as string).select("store").single();
  if (error || !img) return Response.json({ error: error?.message ?? "Not found" }, { status: 404 });
  return Response.json({ kit: await loadBrandKit(auth.db, img.store as string) });
}

/** DELETE ?id= — remove a product photo. */
export async function DELETE(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!isUuid(id)) return Response.json({ error: "Missing id" }, { status: 400 });
  const { data: img } = await auth.db.from("remake_brand_images").select("store, path").eq("id", id).maybeSingle();
  if (!img) return Response.json({ error: "Not found" }, { status: 404 });
  await auth.db.storage.from(BOARD_BUCKET).remove([img.path as string]);
  await auth.db.from("remake_brand_images").delete().eq("id", id);
  return Response.json({ kit: await loadBrandKit(auth.db, img.store as string) });
}
