"use client";

import { useState } from "react";
import { Loader2, Send, ImagePlus, X, Newspaper } from "lucide-react";
import { toast } from "sonner";
import { PageSelector } from "@/components/marketing/create/page-selector";

export function PagePostForm() {
  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);

  const canPost = pageId && (message.trim() || imageFile) && !posting;

  async function handlePost() {
    if (!pageId) {
      toast.error("Pumili muna ng Facebook Page.");
      return;
    }
    if (!message.trim() && !imageFile) {
      toast.error("Maglagay ng message o larawan.");
      return;
    }

    setPosting(true);
    try {
      const form = new FormData();
      form.append("pageId", pageId);
      form.append("message", message.trim());
      if (link.trim()) form.append("link", link.trim());
      if (imageFile) form.append("image", imageFile);

      const res = await fetch("/api/facebook/page-post", {
        method: "POST",
        body: form,
      });
      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "Hindi na-post. Subukan ulit.");
        return;
      }

      toast.success(
        json.permalink ? (
          <span>
            Na-post na sa {pageName || "Page"}!{" "}
            <a
              href={json.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium"
            >
              Tingnan ang post
            </a>
          </span>
        ) : (
          `Na-post na sa ${pageName || "Page"}!`
        )
      );

      // Clear form (keep the selected page)
      setMessage("");
      setLink("");
      setImageFile(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Hindi na-post. Subukan ulit.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Newspaper size={24} className="text-white" />
        <h1 className="text-2xl font-semibold text-white">Page Postings</h1>
      </div>
      <p className="text-sm text-gray-400 mb-6">
        Mag-publish ng isang organic post sa iyong Facebook Page.
      </p>

      <div className="space-y-5 rounded-xl border border-gray-800 bg-gray-900/40 p-5">
        <PageSelector
          selectedPageId={pageId}
          onChange={(id, name) => {
            setPageId(id);
            setPageName(name);
          }}
        />

        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="Ano ang gusto mong i-post?"
            className="w-full rounded-lg border border-gray-700 bg-black/30 p-3 text-sm text-white placeholder-gray-500 focus:border-white focus:outline-none resize-y"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1.5">
            Link <span className="text-gray-600">(optional)</span>
          </label>
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-lg border border-gray-700 bg-black/30 p-3 text-sm text-white placeholder-gray-500 focus:border-white focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1.5">
            Larawan <span className="text-gray-600">(optional)</span>
          </label>
          {imageFile ? (
            <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-black/30 p-3">
              <span className="text-sm text-gray-300 truncate">
                {imageFile.name}
              </span>
              <button
                type="button"
                onClick={() => setImageFile(null)}
                className="text-gray-400 hover:text-white cursor-pointer"
                aria-label="Remove image"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-2 rounded-lg border border-dashed border-gray-700 p-3 text-sm text-gray-400 hover:border-gray-600 cursor-pointer">
              <ImagePlus size={16} />
              Pumili ng larawan
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
        </div>

        <button
          type="button"
          onClick={handlePost}
          disabled={!canPost}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {posting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Nagpo-post...
            </>
          ) : (
            <>
              <Send size={16} />
              I-post
            </>
          )}
        </button>
      </div>
    </div>
  );
}
