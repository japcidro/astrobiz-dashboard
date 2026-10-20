import { CartoonHook } from "@/components/cartoon/cartoon-hook";

export const dynamic = "force-dynamic";

// Owner and marketing: the (owner) layout already 404s everyone else.
export default async function CartoonGeneratorHookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CartoonHook id={id} />;
}
