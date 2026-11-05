import { LaunchedCreativesView } from "@/components/marketing/launched/launched-creatives-view";

export const dynamic = "force-dynamic";

// Built in the Development Dashboard first; the (owner) layout limits it to
// the owner and the marketing team. When Julius is happy with it, it moves
// under (dashboard)/marketing next to Submitted Ad Videos.
export default function LaunchedCreativesPage() {
  return <LaunchedCreativesView />;
}
