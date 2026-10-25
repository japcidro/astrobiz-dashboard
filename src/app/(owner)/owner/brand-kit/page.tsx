import { Suspense } from "react";
import { BrandKitPage } from "@/components/brand-kit/brand-kit-page";

export const dynamic = "force-dynamic";

// Owner and marketing: the (owner) layout already 404s everyone else.
export default function BrandKitRoute() {
  return (
    <Suspense fallback={null}>
      <BrandKitPage />
    </Suspense>
  );
}
