import { MarketingBoard } from "@/components/marketing-board/marketing-board";

export const dynamic = "force-dynamic";

// Owner-only while the board is being built; the (owner) layout 404s
// everyone else. When it is ready for the team it moves to the operations
// dashboard (see PROJECT_CONTEXT.md, "Owner space").
export default function MarketingBoardPage() {
  return <MarketingBoard />;
}
