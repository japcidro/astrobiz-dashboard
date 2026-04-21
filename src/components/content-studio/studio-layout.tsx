"use client";

import { useState } from "react";
import { MoodboardPanel } from "./moodboard-panel";
import { ProductPanel } from "./product-panel";
import { PromptPanel } from "./prompt-panel";

interface MoodboardImage {
  id: string;
  image_url: string;
  label: string | null;
}
interface ProductPhoto {
  id: string;
  product_name: string;
  image_url: string;
}
interface GeneratedImage {
  id: string;
  image_url: string;
  prompt: string | null;
  output_type: string;
  created_at: string;
  rating?: number | null;
}

export function StudioLayout({
  moodboard: initialMoodboard,
  products: initialProducts,
  generated: initialGenerated,
  storeName,
}: {
  moodboard: MoodboardImage[];
  products: ProductPhoto[];
  generated: GeneratedImage[];
  storeName: string;
}) {
  const [moodboard, setMoodboard] = useState(initialMoodboard);
  const [products, setProducts] = useState(initialProducts);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(
    new Set(initialProducts.map((p) => p.id))
  );
  const [generated, setGenerated] = useState(initialGenerated);
  const selectedProducts = products.filter((p) => selectedProductIds.has(p.id));

  return (
    <div className="grid grid-cols-[220px_220px_1fr] gap-3 h-[calc(100vh-220px)]">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl h-full flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-700/50">
          <span className="text-[10px] font-bold font-mono uppercase tracking-widest text-gray-500">
            References {moodboard.length}
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <MoodboardPanel
            images={moodboard}
            storeName={storeName}
            onImagesChange={setMoodboard}
          />
        </div>
      </div>

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl h-full flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-700/50">
          <span className="text-[10px] font-bold font-mono uppercase tracking-widest text-gray-500">
            Product {selectedProducts.length}/{products.length}
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <ProductPanel
            photos={products}
            storeName={storeName}
            onPhotosChange={setProducts}
            selectedIds={selectedProductIds}
            onSelectedChange={setSelectedProductIds}
          />
        </div>
      </div>

      <PromptPanel
        moodboard={moodboard}
        products={selectedProducts}
        generated={generated}
        storeName={storeName}
        onGeneratedChange={setGenerated}
        onMoodboardChange={setMoodboard}
      />
    </div>
  );
}
