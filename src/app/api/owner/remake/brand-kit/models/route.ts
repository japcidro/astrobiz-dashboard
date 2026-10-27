import { requireBoardUser } from "@/lib/marketing-board/auth";
import { addUploadedPerson, findBrandFolder, isUuid, loadBrandModels } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

const storeOf = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);

/** GET ?store= — the brand's models: the people in its person-library folder. */
export async function GET(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const store = storeOf(new URL(request.url).searchParams.get("store"));
  if (!store) return Response.json({ error: "Missing store" }, { status: 400 });
  return Response.json({ models: await loadBrandModels(auth.db, store) });
}

/** POST { store, path, name? } — add a photo uploaded via /upload-url (kind "person") to the brand's folder, making the folder if needed. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { store?: unknown; path?: unknown; name?: unknown } | null;
  const store = storeOf(b?.store);
  if (!store) return Response.json({ error: "Missing store" }, { status: 400 });
  if (typeof b?.path !== "string") return Response.json({ error: "Upload the photo first" }, { status: 400 });
  let folder = await findBrandFolder(auth.db, store);
  if (!folder) {
    const { data, error } = await auth.db.from("remake_people_folders").insert({ name: store }).select("id, name").single();
    // Two uploads at once can race to make it; the loser finds the winner's folder.
    folder = data ?? (error?.code === "23505" ? await findBrandFolder(auth.db, store) : null);
    if (!folder) return Response.json({ error: error?.message ?? "Could not make the folder" }, { status: 500 });
  }
  const result = await addUploadedPerson(auth.db, { path: b.path, name: typeof b.name === "string" ? b.name : "", folder_id: folder.id });
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ models: await loadBrandModels(auth.db, store) });
}

/** DELETE ?id=&store= — take a person out of the brand's folder. They stay in the person library, Unsorted. */
export async function DELETE(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const store = storeOf(params.get("store"));
  if (!isUuid(id) || !store) return Response.json({ error: "Missing id or store" }, { status: 400 });
  const folder = await findBrandFolder(auth.db, store);
  if (folder) await auth.db.from("remake_people").update({ folder_id: null }).eq("id", id).eq("folder_id", folder.id);
  return Response.json({ models: await loadBrandModels(auth.db, store) });
}
