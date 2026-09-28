import { HookStudio } from "@/components/hook-studio/hook-studio";

export const dynamic = "force-dynamic";

// Owner-only: the (owner) layout already 404s everyone else.
export default function HookStudioPage() {
  return <HookStudio />;
}
