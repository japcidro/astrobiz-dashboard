import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, AlertCircle } from "lucide-react";
import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { StudioLayout } from "@/components/content-studio/studio-layout";
import { StorePicker } from "@/components/content-studio/store-picker";

export const dynamic = "force-dynamic";

export default async function ContentStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (!["admin", "marketing"].includes(employee.role)) redirect("/dashboard");

  const supabase = await createClient();
  const { data: storeRows } = await supabase
    .from("shopify_stores")
    .select("name")
    .order("name");
  const stores = storeRows ?? [];

  const { store: storeParam } = await searchParams;
  const storeName = storeParam || stores[0]?.name || "";

  if (stores.length === 0) {
    return (
      <div>
        <div className="mb-6">
          <p className="text-[10px] font-bold font-mono uppercase tracking-widest text-gray-500">
            /content-studio · image generation
          </p>
          <h1 className="text-2xl font-bold tracking-tight mt-1 text-white">Content Studio</h1>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-400">
            No Shopify stores connected yet. Go to{" "}
            <a href="/admin/settings" className="underline font-medium text-white">
              Settings
            </a>{" "}
            to add one.
          </p>
        </div>
      </div>
    );
  }

  const [
    { data: moodboard },
    { data: products },
    { data: generated },
    { count: knowledgeDocCount },
  ] = await Promise.all([
    supabase
      .from("moodboard_images")
      .select("id, image_url, label")
      .eq("store_name", storeName)
      .order("created_at", { ascending: false }),
    supabase
      .from("product_photos")
      .select("id, product_name, image_url")
      .eq("store_name", storeName)
      .order("created_at", { ascending: false }),
    supabase
      .from("generated_images")
      .select("id, image_url, prompt, output_type, created_at, rating")
      .eq("store_name", storeName)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("ai_store_docs")
      .select("id", { count: "exact", head: true })
      .eq("store_name", storeName)
      .not("doc_type", "like", "system_%"),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] font-bold font-mono uppercase tracking-widest text-gray-500">
            /content-studio · image generation
          </p>
          <h1 className="text-2xl font-bold tracking-tight mt-1 text-white">Content Studio</h1>
          <p className="text-sm text-gray-400 mt-1">
            Generate on-brand images from moodboards, product photos, and prompts.
          </p>
        </div>
        <StorePicker stores={stores} current={storeName} />
      </div>

      {(knowledgeDocCount ?? 0) > 0 ? (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-emerald-900/20 border border-emerald-700/50 rounded-lg">
          <BookOpen size={14} className="text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-300">
            Using <span className="font-semibold">{knowledgeDocCount}</span>{" "}
            knowledge doc{knowledgeDocCount === 1 ? "" : "s"} from{" "}
            <Link
              href="/marketing/ai-settings"
              className="underline hover:text-emerald-200"
            >
              AI Knowledge
            </Link>{" "}
            — every generation will be tuned to this store&apos;s brand voice.
          </p>
        </div>
      ) : (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
          <AlertCircle size={14} className="text-yellow-400 shrink-0" />
          <p className="text-xs text-yellow-300">
            No knowledge docs for <span className="font-semibold">{storeName}</span>{" "}
            yet — generations won&apos;t know your brand voice.{" "}
            <Link
              href="/marketing/ai-settings"
              className="underline hover:text-yellow-200 font-medium"
            >
              Upload brand docs →
            </Link>
          </p>
        </div>
      )}

      <StudioLayout
        key={storeName}
        moodboard={moodboard ?? []}
        products={products ?? []}
        generated={generated ?? []}
        storeName={storeName}
      />
    </div>
  );
}
