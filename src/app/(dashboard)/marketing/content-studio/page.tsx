import { redirect } from "next/navigation";
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
      <div className="p-6">
        <div className="mb-6">
          <p className="text-[10px] font-bold font-mono uppercase tracking-widest text-neutral-400">
            /content-studio · image generation
          </p>
          <h1 className="text-2xl font-bold tracking-tight mt-1">Content Studio</h1>
        </div>
        <div className="border border-neutral-200 p-8 text-center">
          <p className="text-sm text-neutral-500">
            No Shopify stores connected yet. Go to{" "}
            <a href="/admin/settings" className="underline font-medium">
              Settings
            </a>{" "}
            to add one.
          </p>
        </div>
      </div>
    );
  }

  const [{ data: moodboard }, { data: products }, { data: generated }] = await Promise.all([
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
  ]);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] font-bold font-mono uppercase tracking-widest text-neutral-400">
            /content-studio · image generation
          </p>
          <h1 className="text-2xl font-bold tracking-tight mt-1">Content Studio</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Generate on-brand images from moodboards, product photos, and prompts.
          </p>
        </div>
        <StorePicker stores={stores} current={storeName} />
      </div>
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
