import { Suspense } from "react";
import { ScriptGenerator } from "@/components/script-studio/script-generator";

export const dynamic = "force-dynamic";

// Owner and marketing: the (owner) layout already 404s everyone else.
export default function ScriptGeneratorPage() {
  return (
    <Suspense fallback={null}>
      <ScriptGenerator />
    </Suspense>
  );
}
