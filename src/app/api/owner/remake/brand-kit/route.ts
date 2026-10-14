import { requireBoardUser } from "@/lib/marketing-board/auth";
import { BOARD_BUCKET } from "@/lib/marketing-board/storage";
import { isUuid, loadBrandKit } from "@/lib/remake/views";

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

/** PUT { store, rules } — save the rules. */
export async function PUT(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { store?: unknown; rules?: unknown } | null;
  const store = storeOf(b?.store);
  if (!store) return Response.json({ error: "Missing store" }, { status: 400 });
  const rules = typeof b?.rules === "string" ? b.rules.trim().slice(0, 1500) : "";
  const { error } = await auth.db.from("remake_brand_kits").upsert({ store, rules, updated_by: auth.employee.id, updated_at: new Date().toISOString() }, { onConflict: "store" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
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
  const { error } = await auth.db.from("remake_brand_images").insert({ store, path, label: typeof b?.label === "string" ? b.label.slice(0, 80) : null });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ kit: await loadBrandKit(auth.db, store) });
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
