"use client";

import { useState, useRef, useEffect } from "react";
import { Upload, Loader2, Search, Plus, Check, BookOpen, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { addMoodboardImage, deleteMoodboardImage } from "@/lib/content-studio/actions";
import { toast } from "sonner";

interface MoodboardImage {
  id: string;
  image_url: string;
  label: string | null;
}
interface SavedImage {
  id: string;
  image_url: string;
  label: string | null;
  album: string;
}
interface SearchResult {
  url: string;
  title: string;
  source: string;
}

export function MoodboardPanel({
  images: initial,
  storeName,
  onImagesChange,
}: {
  images: MoodboardImage[];
  storeName: string;
  onImagesChange?: (images: MoodboardImage[]) => void;
}) {
  const [activeRefs, setActiveRefsLocal] = useState(initial);
  useEffect(() => {
    setActiveRefsLocal(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.length]);
  const [savedImages, setSavedImages] = useState<SavedImage[]>([]);
  const [view, setView] = useState<"refs" | "library">("refs");
  const [selectedLibrary, setSelectedLibrary] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [addingUrls, setAddingUrls] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const setActiveRefs = (
    updater: MoodboardImage[] | ((prev: MoodboardImage[]) => MoodboardImage[])
  ) => {
    setActiveRefsLocal((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      onImagesChange?.(next);
      return next;
    });
  };

  const saveToLibrary = async (imageUrl: string, label: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("saved_images")
      .insert({ store_name: storeName, image_url: imageUrl, label, album: "General" })
      .select("id")
      .single();
    if (data)
      setSavedImages((prev) => [
        { id: data.id, image_url: imageUrl, label, album: "General" },
        ...prev,
      ]);
  };

  // Paste from clipboard
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            setUploading(true);
            try {
              const supabase = createClient();
              const ext = file.type === "image/png" ? "png" : "jpg";
              const path = `moodboard/${Date.now()}-pasted.${ext}`;
              await supabase.storage
                .from("content-studio")
                .upload(path, file, { upsert: true });
              const {
                data: { publicUrl },
              } = supabase.storage.from("content-studio").getPublicUrl(path);
              await saveToLibrary(publicUrl, "Pasted");
              const dbId = await addMoodboardImage(storeName, publicUrl);
              setActiveRefs((prev) => [
                ...prev,
                { id: dbId, image_url: publicUrl, label: "Pasted" },
              ]);
              toast.success("Pasted!");
            } catch {
              toast.error("Failed");
            } finally {
              setUploading(false);
            }
          }
        }
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeName]);

  // Load library
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("saved_images")
      .select("id, image_url, label, album")
      .eq("store_name", storeName)
      .order("created_at", { ascending: false })
      .then(({ data }) => setSavedImages(data ?? []));
  }, [storeName]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch("/api/ai/search-brand-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery.trim() }),
      });
      const data = await res.json();
      if (data.success) setSearchResults(data.images);
      else toast.error(data.error || "Failed");
    } catch {
      toast.error("Failed");
    } finally {
      setSearching(false);
    }
  };

  const handlePasteUrl = async (url: string) => {
    setAddingUrls((prev) => new Set([...prev, url]));
    try {
      const res = await fetch("/api/ai/search-brand-images", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: url, store_name: storeName, label: "Pasted" }),
      });
      const data = await res.json();
      if (data.success) {
        await saveToLibrary(data.url, "Pasted");
        const dbId = await addMoodboardImage(storeName, data.url);
        setActiveRefs((prev) => [
          ...prev,
          { id: dbId, image_url: data.url, label: "Pasted" },
        ]);
        setSearchQuery("");
        toast.success("Added!");
      } else toast.error(data.error || "Failed");
    } catch {
      toast.error("Failed");
    } finally {
      setAddingUrls((prev) => {
        const n = new Set(prev);
        n.delete(url);
        return n;
      });
    }
  };

  const handleAddFromSearch = async (result: SearchResult) => {
    setAddingUrls((prev) => new Set([...prev, result.url]));
    try {
      const res = await fetch("/api/ai/search-brand-images", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: result.url,
          store_name: storeName,
          label: result.title,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await saveToLibrary(data.url, result.title);
        const dbId = await addMoodboardImage(storeName, data.url, result.title);
        setActiveRefs((prev) => [
          ...prev,
          { id: dbId, image_url: data.url, label: result.title },
        ]);
        toast.success("Added!");
      } else toast.error(data.error || "Failed");
    } catch {
      toast.error("Failed");
    } finally {
      setAddingUrls((prev) => {
        const n = new Set(prev);
        n.delete(result.url);
        return n;
      });
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    const supabase = createClient();
    for (const file of Array.from(files)) {
      try {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `moodboard/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`;
        await supabase.storage.from("content-studio").upload(path, file, { upsert: true });
        const {
          data: { publicUrl },
        } = supabase.storage.from("content-studio").getPublicUrl(path);
        await saveToLibrary(publicUrl, file.name);
        const dbId = await addMoodboardImage(storeName, publicUrl);
        setActiveRefs((prev) => [
          ...prev,
          { id: dbId, image_url: publicUrl, label: file.name },
        ]);
      } catch (e) {
        toast.error(`Failed: ${e instanceof Error ? e.message : "error"}`);
      }
    }
    setUploading(false);
  };

  const useSelectedAsRefs = async () => {
    const toAdd = savedImages.filter(
      (s) =>
        selectedLibrary.has(s.id) && !activeRefs.some((r) => r.image_url === s.image_url)
    );
    for (const s of toAdd) {
      const dbId = await addMoodboardImage(storeName, s.image_url, s.label || undefined);
      setActiveRefs((prev) => [
        ...prev,
        { id: dbId, image_url: s.image_url, label: s.label },
      ]);
    }
    setSelectedLibrary(new Set());
    setView("refs");
    toast.success(`${toAdd.length} added`);
  };

  const deleteSelectedFromLibrary = async () => {
    const supabase = createClient();
    for (const id of selectedLibrary) {
      await supabase.from("saved_images").delete().eq("id", id);
    }
    setSavedImages((prev) => prev.filter((s) => !selectedLibrary.has(s.id)));
    setSelectedLibrary(new Set());
    toast.success("Deleted");
  };

  if (view === "refs") {
    return (
      <div className="h-full flex flex-col">
        <div className="p-2 border-b border-neutral-200">
          <div className="flex gap-1">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  searchQuery.trim().startsWith("http")
                    ? handlePasteUrl(searchQuery.trim())
                    : handleSearch();
                }
              }}
              placeholder="Search or paste URL"
              className="flex-1 h-7 border border-neutral-300 px-2 text-[10px] font-mono"
            />
            <button
              onClick={() =>
                searchQuery.trim().startsWith("http")
                  ? handlePasteUrl(searchQuery.trim())
                  : handleSearch()
              }
              disabled={searching || !searchQuery.trim()}
              className="px-2 h-7 border border-neutral-300 hover:bg-neutral-50 disabled:opacity-50 cursor-pointer"
            >
              {searching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : searchQuery.trim().startsWith("http") ? (
                <Plus className="h-3 w-3" />
              ) : (
                <Search className="h-3 w-3" />
              )}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {searchResults.length > 0 && (
            <div className="mb-3">
              <p className="text-[9px] font-bold font-mono text-neutral-400 uppercase mb-1">
                Tap to add
              </p>
              <div className="grid grid-cols-2 gap-1.5 max-h-[500px] overflow-y-auto">
                {searchResults.map((r, i) => {
                  const isAdding = addingUrls.has(r.url);
                  const isAdded = activeRefs.some((img) => img.image_url === r.url);
                  return (
                    <button
                      key={i}
                      onClick={() => !isAdded && handleAddFromSearch(r)}
                      disabled={isAdding || isAdded}
                      className={`relative border ${
                        isAdded
                          ? "border-emerald-300 opacity-60"
                          : "border-neutral-200 hover:border-neutral-400"
                      }`}
                    >
                      <img
                        src={r.url}
                        alt=""
                        className="w-full aspect-square object-cover"
                        onError={(e) => (e.currentTarget.style.display = "none")}
                      />
                      {isAdding && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin text-white" />
                        </div>
                      )}
                      {isAdded && (
                        <div className="absolute top-1 right-1 bg-emerald-500 text-white p-0.5">
                          <Check className="h-2.5 w-2.5" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setSearchResults([])}
                className="w-full mt-1 text-[9px] text-neutral-400 hover:text-neutral-900 font-mono cursor-pointer"
              >
                Clear
              </button>
            </div>
          )}

          {selectedRefs.size > 0 && (
            <div className="flex items-center justify-between mb-1.5 bg-neutral-50 px-2 py-1.5 border border-neutral-200">
              <span className="text-[9px] font-mono font-bold">
                {selectedRefs.size} selected
              </span>
              <div className="flex gap-1">
                <button
                  onClick={async () => {
                    for (const id of selectedRefs) {
                      const ref = activeRefs.find((r) => r.id === id);
                      if (ref) await saveToLibrary(ref.image_url, ref.label || "Saved");
                    }
                    setSelectedRefs(new Set());
                    toast.success("Saved to library!");
                  }}
                  className="px-2 py-0.5 text-[9px] font-mono font-bold bg-neutral-900 text-white cursor-pointer"
                >
                  Save
                </button>
                <button
                  onClick={async () => {
                    for (const id of selectedRefs) {
                      try {
                        await deleteMoodboardImage(id);
                      } catch {}
                    }
                    setActiveRefs((prev) =>
                      prev.filter((r) => !selectedRefs.has(r.id))
                    );
                    setSelectedRefs(new Set());
                    toast.success("Deleted");
                  }}
                  className="px-2 py-0.5 text-[9px] font-mono font-bold text-red-500 border border-red-200 cursor-pointer"
                >
                  Delete
                </button>
                <button
                  onClick={() => setSelectedRefs(new Set())}
                  className="px-1 py-0.5 text-[9px] text-neutral-400 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          {activeRefs.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {activeRefs.map((img) => {
                const isSelected = selectedRefs.has(img.id);
                return (
                  <button
                    key={img.id}
                    onClick={() =>
                      setSelectedRefs((prev) => {
                        const n = new Set(prev);
                        if (n.has(img.id)) n.delete(img.id);
                        else n.add(img.id);
                        return n;
                      })
                    }
                    className={`relative border-2 ${
                      isSelected ? "border-neutral-900" : "border-transparent"
                    }`}
                  >
                    <img
                      src={img.image_url}
                      alt=""
                      className="w-full aspect-square object-cover"
                    />
                    {isSelected && (
                      <div className="absolute top-0.5 right-0.5 bg-neutral-900 text-white p-0.5">
                        <Check className="h-2.5 w-2.5" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-[10px] text-neutral-400 text-center py-8">
              Search, paste URL, upload, or pick from library
            </p>
          )}
        </div>

        <div className="p-2 border-t border-neutral-200 space-y-1">
          <button
            onClick={() => setView("library")}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-mono font-bold text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50 border border-neutral-200 cursor-pointer"
          >
            <BookOpen className="h-3 w-3" /> Saved Library{" "}
            {savedImages.length > 0 ? `(${savedImages.length})` : ""}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-mono font-bold text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50 border border-neutral-200 disabled:opacity-50 cursor-pointer"
          >
            {uploading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            {uploading ? "Uploading..." : "+ Upload"}
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

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b border-neutral-200 flex items-center justify-between">
        <button
          onClick={() => {
            setView("refs");
            setSelectedLibrary(new Set());
          }}
          className="flex items-center gap-1 text-[10px] font-mono font-bold text-neutral-500 hover:text-neutral-900 cursor-pointer"
        >
          <ArrowLeft className="h-3 w-3" /> Back
        </button>
        <span className="text-[10px] font-mono text-neutral-400">
          {savedImages.length} saved
        </span>
      </div>

      {selectedLibrary.size > 0 && (
        <div className="px-2 py-1.5 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
          <span className="text-[9px] font-mono font-bold">
            {selectedLibrary.size} selected
          </span>
          <div className="flex gap-1">
            <button
              onClick={useSelectedAsRefs}
              className="px-2 py-1 text-[9px] font-mono font-bold bg-neutral-900 text-white hover:bg-neutral-800 cursor-pointer"
            >
              Use as Refs
            </button>
            <button
              onClick={deleteSelectedFromLibrary}
              className="px-2 py-1 text-[9px] font-mono font-bold text-red-500 border border-red-200 hover:bg-red-50 cursor-pointer"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {savedImages.length === 0 ? (
          <p className="text-[10px] text-neutral-400 text-center py-8">
            No saved images yet. Search, paste, or upload to build your library.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {savedImages.map((s) => {
              const isSelected = selectedLibrary.has(s.id);
              const isActive = activeRefs.some((r) => r.image_url === s.image_url);
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedLibrary((prev) => {
                      const n = new Set(prev);
                      if (n.has(s.id)) n.delete(s.id);
                      else n.add(s.id);
                      return n;
                    });
                  }}
                  className={`relative border-2 ${
                    isSelected
                      ? "border-neutral-900"
                      : isActive
                      ? "border-emerald-300"
                      : "border-transparent"
                  }`}
                >
                  <img
                    src={s.image_url}
                    alt=""
                    className="w-full aspect-square object-cover"
                  />
                  {isSelected && (
                    <div className="absolute top-0.5 right-0.5 bg-neutral-900 text-white p-0.5">
                      <Check className="h-2.5 w-2.5" />
                    </div>
                  )}
                  {isActive && !isSelected && (
                    <div className="absolute top-0.5 right-0.5 bg-emerald-500 text-white p-0.5">
                      <Check className="h-2.5 w-2.5" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
