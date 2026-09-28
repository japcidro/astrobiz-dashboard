import { UgcGenerator } from "@/components/hook-studio/ugc-generator";

export const dynamic = "force-dynamic";

// Owner-only: the (owner) layout already 404s everyone else.
export default function UgcGeneratorPage() {
  return <UgcGenerator />;
}
