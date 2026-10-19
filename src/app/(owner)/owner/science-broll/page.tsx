import { ScienceBrollList } from "@/components/science-broll/science-broll-list";

export const dynamic = "force-dynamic";

// Owner and marketing: the (owner) layout already 404s everyone else.
export default function ScienceBrollPage() {
  return <ScienceBrollList />;
}
