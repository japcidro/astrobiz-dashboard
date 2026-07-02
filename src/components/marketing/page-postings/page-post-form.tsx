"use client";

import { useState } from "react";
import { Loader2, Send, ImagePlus, X, Newspaper } from "lucide-react";
import { toast } from "sonner";
import { PageSelector } from "@/components/marketing/create/page-selector";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

/** Extract a readable error from a Facebook Graph API JSON error body. */
function fbErrorMessage(json: unknown, fallback: string): string {
  const err = (json as { error?: Record<string, string> } | null)?.error;
  return err?.error_user_msg || err?.message || fallback;
}

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
      // Get a page access token from our server, then publish directly to
      // Facebook from the browser (avoids the serverless request-body limit
      // that breaks large image uploads).
      const tokenRes = await fetch(
        `/api/facebook/page-post?pageId=${encodeURIComponent(pageId)}`
      );
      const tokenJson = await tokenRes.json().catch(() => null);
      if (!tokenRes.ok || !tokenJson?.token) {
        toast.error(tokenJson?.error || "Hindi makuha ang page token.");
        return;
      }
      const token: string = tokenJson.token;

      const trimmed = message.trim();
      let res: Response;

      if (imageFile) {
        // Photo post — multipart, published by default.
        const fbForm = new FormData();
        fbForm.append("access_token", token);
        fbForm.append("source", imageFile);
        if (trimmed) fbForm.append("caption", trimmed);
        res = await fetch(`${FB_API_BASE}/${pageId}/photos`, {
          method: "POST",
          body: fbForm,
        });
      } else {
        // Text (+ optional link) post to the page feed.
        const params = new URLSearchParams({ access_token: token, message: trimmed });
        if (link.trim()) params.append("link", link.trim());
        res = await fetch(`${FB_API_BASE}/${pageId}/feed`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
      }

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(fbErrorMessage(json, "Hindi na-post. Subukan ulit."));
        return;
      }

      // photos returns { id, post_id }; feed returns { id }
      const postId: string = json?.post_id || json?.id || "";
      const permalink = postId ? `https://www.facebook.com/${postId}` : null;

      toast.success(
        permalink ? (
          <span>
            Na-post na sa {pageName || "Page"}!{" "}
            <a
              href={permalink}
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
