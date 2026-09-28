import { Suspense } from "react";
import { HookStudio } from "@/components/hook-studio/hook-studio";

export const dynamic = "force-dynamic";

// Owner-only: the (owner) layout already 404s everyone else.
// Suspense: the page reads ?ugc= with useSearchParams.
export default function HookStudioPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
      <HookStudio />
    </Suspense>
  );
}
