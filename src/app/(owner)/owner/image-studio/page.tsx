import { Suspense } from "react";
import { ImageStudio } from "@/components/image-studio/image-studio";

export const dynamic = "force-dynamic";

// Owner and marketing: the (owner) layout already 404s everyone else.
export default function ImageStudioPage() {
  return (
    <Suspense fallback={null}>
      <ImageStudio />
    </Suspense>
  );
}
