import { ScienceBroll } from "@/components/science-broll/science-broll";

export const dynamic = "force-dynamic";

// Owner and marketing: the (owner) layout already 404s everyone else.
export default async function ScienceBrollProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScienceBroll id={id} />;
}
