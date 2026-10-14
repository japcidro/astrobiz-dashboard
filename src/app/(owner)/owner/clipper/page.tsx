import { RemakeList } from "@/components/remake/remake-list";

export const dynamic = "force-dynamic";

// Owner-only: the (owner) layout already 404s everyone else.
export default function RemakeStudioPage() {
  return <RemakeList />;
}
