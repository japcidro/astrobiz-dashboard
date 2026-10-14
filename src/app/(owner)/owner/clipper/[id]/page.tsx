import { RemakeProject } from "@/components/remake/remake-project";

export const dynamic = "force-dynamic";

// Owner-only: the (owner) layout already 404s everyone else.
export default async function RemakeProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RemakeProject id={id} />;
}
