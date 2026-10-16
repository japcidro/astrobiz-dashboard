import { HookGeneratorList } from "@/components/hook-generator/hook-generator-list";

export const dynamic = "force-dynamic";

// Owner and marketing: the (owner) layout already 404s everyone else.
export default function HookGeneratorPage() {
  return <HookGeneratorList />;
}
