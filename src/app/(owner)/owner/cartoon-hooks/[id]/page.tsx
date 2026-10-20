import { redirect } from "next/navigation";

// Cartoon Hooks became the Cartoon Generator; old links still land there.
export default async function CartoonHookRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/owner/cartoon-generator/${id}`);
}
