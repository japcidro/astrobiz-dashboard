import { requireBoardUser } from "@/lib/marketing-board/auth";

export const dynamic = "force-dynamic";

/** POST { name } — a new folder in the person library. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 80) : "";
  if (!name) return Response.json({ error: "Give the folder a name" }, { status: 400 });
  const { data, error } = await auth.db.from("remake_people_folders").insert({ name }).select("*").single();
  if (error || !data) return Response.json({ error: error?.code === "23505" ? "A folder with that name already exists" : error?.message ?? "Could not create the folder" }, { status: 400 });
  return Response.json({ folder: data });
}
