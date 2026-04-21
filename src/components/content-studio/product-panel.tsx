"use client";

import { useState, useRef } from "react";
import { Upload, X, Loader2, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { addProductPhoto, deleteProductPhoto } from "@/lib/content-studio/actions";
import { toast } from "sonner";

interface ProductPhoto {
  id: string;
  product_name: string;
  image_url: string;
}

export function ProductPanel({
  photos: initial,
  storeName,
  onPhotosChange,
  selectedIds,
  onSelectedChange,
}: {
  photos: ProductPhoto[];
  storeName: string;
  onPhotosChange?: (photos: ProductPhoto[]) => void;
  selectedIds?: Set<string>;
  onSelectedChange?: (ids: Set<string>) => void;
}) {
  const [photosLocal, setPhotosLocal] = useState(initial);
  const photos = photosLocal;
  const setPhotos = (
    updater: ProductPhoto[] | ((prev: ProductPhoto[]) => ProductPhoto[])
  ) => {
    setPhotosLocal((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      onPhotosChange?.(next);
      return next;
    });
  };
  const [uploading, setUploading] = useState(false);
  const [productName, setProductName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!productName.trim()) {
      toast.error("Enter product name first");
      return;
    }
    setUploading(true);
    const supabase = createClient();

    for (const file of Array.from(files)) {
      try {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `products/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from("content-studio")
          .upload(path, file, { upsert: true });
        if (error) throw error;
        const {
          data: { publicUrl },
        } = supabase.storage.from("content-studio").getPublicUrl(path);
        const dbId = await addProductPhoto(storeName, productName.trim(), publicUrl);
        setPhotos((prev) => [
          ...prev,
          { id: dbId, product_name: productName.trim(), image_url: publicUrl },
        ]);
      } catch (e) {
        toast.error(`Failed: ${e instanceof Error ? e.message : "Upload error"}`);
      }
    }
    setUploading(false);
    toast.success(`${files.length} photo(s) added`);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProductPhoto(id);
      setPhotos((prev) => prev.filter((p) => p.id !== id));
    } catch {
      toast.error("Failed to delete");
    }
  };

  const grouped = new Map<string, ProductPhoto[]>();
  photos.forEach((p) => {
    const list = grouped.get(p.product_name) || [];
    list.push(p);
    grouped.set(p.product_name, list);
  });

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {grouped.size === 0 ? (
          <div className="text-center py-8">
            <span className="text-[10px] text-neutral-400">No product photos yet</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {Array.from(grouped.entries()).map(([name, items]) => {
              const allSelected = items.every((p) => selectedIds?.has(p.id));
              const someSelected = items.some((p) => selectedIds?.has(p.id));
              return (
                <button
                  key={name}
                  onClick={() => {
                    if (!onSelectedChange) return;
                    const ids = new Set(selectedIds);
                    if (allSelected) {
                      items.forEach((p) => ids.delete(p.id));
                    } else {
                      items.forEach((p) => ids.add(p.id));
                    }
                    onSelectedChange(ids);
                  }}
                  className={`relative border-2 text-left group ${
                    allSelected
                      ? "border-neutral-900"
                      : "border-neutral-200 hover:border-neutral-400"
                  }`}
                >
                  <img
                    src={items[0].image_url}
                    alt={name}
                    className="w-full aspect-square object-cover"
                  />
                  <div
                    className={`px-1.5 py-1 text-[9px] font-mono font-bold truncate ${
                      someSelected ? "text-neutral-900" : "text-neutral-400"
                    }`}
                  >
                    {name}
                  </div>
                  {allSelected && (
                    <div className="absolute top-0.5 left-0.5 bg-neutral-900 text-white p-0.5">
                      <Check className="h-2.5 w-2.5" />
                    </div>
                  )}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(items[0].id);
                    }}
                    className="absolute top-0.5 right-0.5 bg-black/60 text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <X className="h-2.5 w-2.5" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="p-2 border-t border-neutral-200 space-y-1.5">
        <input
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="Product name (e.g. Discovery Set)"
          className="w-full h-7 border border-neutral-300 px-2 text-[10px] font-mono"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || !productName.trim()}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-mono font-bold text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50 border border-neutral-200 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {uploading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          {uploading ? "Uploading..." : "+ Add Photos"}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          handleUpload(e.target.files);
          e.target.value = "";
        }}
        className="hidden"
      />
    </div>
  );
}
