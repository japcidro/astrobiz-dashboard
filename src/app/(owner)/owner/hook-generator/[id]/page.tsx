import { HookGeneratorHook } from "@/components/hook-generator/hook-generator-hook";

export const dynamic = "force-dynamic";

// Owner and marketing: the (owner) layout already 404s everyone else.
export default async function HookGeneratorHookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HookGeneratorHook id={id} />;
}
