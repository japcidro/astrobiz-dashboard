"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Loader2,
  Trash2,
  Film,
  Image as ImageIcon,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import type {
  ApprovedScriptCreative,
  ApprovedScriptCreativeType,
} from "@/lib/ai/approved-script-creatives-types";
import {
  fetchFbToken,
  uploadImageToFb,
  uploadVideoToFb,
} from "@/lib/facebook/client-uploads";

interface Props {
  scriptId: string;
  storeName: string;
}

interface StoreDefaults {
  ad_account_id: string | null;
}

interface StoreRow {
  id: string;
  name: string;
  store_ad_defaults:
    | StoreDefaults
    | StoreDefaults[]
    | null;
}

interface FbAccount {
  id: string;
  name: string;
  is_active: boolean;
}

// Resolve the FB ad account for a given shopify store by name.
// Uses /api/marketing/store-defaults which joins store_ad_defaults.
// Case/whitespace-insensitive to survive minor drift between
// approved_scripts.store_name and shopify_stores.name.
async function resolveAdAccountId(storeName: string): Promise<string | null> {
  const res = await fetch("/api/marketing/store-defaults");
  if (!res.ok) return null;
  const json = (await res.json()) as { data: StoreRow[] | null };
  const needle = storeName.trim().toLowerCase();
  const row = (json.data ?? []).find(
    (s) => s.name?.trim().toLowerCase() === needle
  );
  const defaults = Array.isArray(row?.store_ad_defaults)
    ? row?.store_ad_defaults[0]
    : row?.store_ad_defaults;
  return defaults?.ad_account_id ?? null;
}

async function fetchFbAdAccounts(): Promise<FbAccount[]> {
  const res = await fetch("/api/facebook/accounts");
  if (!res.ok) return [];
  const json = (await res.json()) as { accounts?: FbAccount[] };
  return json.accounts ?? [];
}

export function ScriptCreativesPanel({ scriptId, storeName }: Props) {
  const [creatives, setCreatives] = useState<ApprovedScriptCreative[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adAccountId, setAdAccountId] = useState<string | null>(null);
  const [fbAccounts, setFbAccounts] = useState<FbAccount[]>([]);
  const [autoResolved, setAutoResolved] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ai/approved-scripts/${scriptId}/creatives`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setCreatives(json.creatives || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [scriptId]);

  useEffect(() => {
    load();
  }, [load]);

  // Try auto-resolve from store_ad_defaults. If that fails, fetch the FB
  // ad accounts list so the user can still pick one inline — no dead-end.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolved = await resolveAdAccountId(storeName).catch(() => null);
      if (cancelled) return;
      if (resolved) {
        setAdAccountId(resolved);
        setAutoResolved(true);
        return;
      }
      const accounts = await fetchFbAdAccounts().catch(() => []);
      if (cancelled) return;
      setFbAccounts(accounts);
      const firstActive = accounts.find((a) => a.is_active) ?? accounts[0];
      if (firstActive) setAdAccountId(firstActive.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [storeName]);

  const handleUpload = async (file: File) => {
    if (!adAccountId) {
      setError(
        `No ad account on "${storeName}". Set one in Marketing → Create Ad → Store defaults first.`
      );
      return;
    }
    setUploading(true);
    setError(null);
    setUploadProgress(`Uploading ${file.name}...`);
    try {
      const token = await fetchFbToken();
      const isVideo = file.type.startsWith("video/");
      const creative_type: ApprovedScriptCreativeType = isVideo
        ? "video"
        : "image";

      let fb_image_hash: string | null = null;
      let fb_video_id: string | null = null;
      if (isVideo) {
        const { video_id } = await uploadVideoToFb(file, adAccountId, token);
        fb_video_id = video_id;
      } else {
        const { image_hash } = await uploadImageToFb(file, adAccountId, token);
        fb_image_hash = image_hash;
      }

      setUploadProgress("Saving to Library...");
      const saveRes = await fetch(
        `/api/ai/approved-scripts/${scriptId}/creatives`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fb_ad_account_id: adAccountId,
            creative_type,
            fb_image_hash,
            fb_video_id,
            file_name: file.name,
          }),
        }
      );
      const saveJson = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveJson.error || "Failed to save");

      setCreatives((prev) => [saveJson.creative, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(
        `/api/ai/approved-scripts/${scriptId}/creatives/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to delete");
      }
      setCreatives((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide shrink-0">
          Creatives ({creatives.length})
        </p>
        <div className="flex items-center gap-2 min-w-0">
          {!autoResolved && fbAccounts.length > 0 && (
            <select
              value={adAccountId ?? ""}
              onChange={(e) => setAdAccountId(e.target.value || null)}
              title="Pick the FB ad account to upload into"
              className="bg-gray-800 border border-gray-700 text-white text-[11px] rounded-lg px-2 py-1.5 max-w-[160px] truncate cursor-pointer"
            >
              {fbAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !adAccountId}
            title={
              !adAccountId
                ? "Pick an ad account first"
                : "Upload an image or video"
            }
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            {uploading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Upload size={12} />
            )}
            {uploading ? "Uploading..." : "Upload creative"}
          </button>
        </div>
      </div>

      {uploadProgress && (
        <p className="mb-2 text-[11px] text-gray-400 bg-gray-800/50 border border-gray-700/50 rounded px-2 py-1.5 flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" />
          {uploadProgress}
        </p>
      )}

      {error && (
        <p className="mb-2 text-[11px] text-red-300 bg-red-900/30 border border-red-700/50 rounded px-2 py-1.5 flex items-center gap-1.5">
          <AlertCircle size={11} />
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-4 text-gray-500">
          <Loader2 size={14} className="animate-spin" />
        </div>
      ) : creatives.length === 0 ? (
        <p className="text-[11px] text-gray-500 italic text-center py-4 bg-gray-800/30 border border-dashed border-gray-700/50 rounded">
          No creatives yet. Upload a finished video or image so the launcher
          can import it directly into Bulk Create.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {creatives.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 bg-gray-800/50 border border-gray-700/50 rounded-md px-2.5 py-1.5 group"
            >
              <div className="flex-shrink-0 w-7 h-7 rounded bg-gray-900 border border-gray-700 flex items-center justify-center text-gray-400">
                {c.creative_type === "video" ? (
                  <Film size={13} />
                ) : (
                  <ImageIcon size={13} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white truncate">
                  {c.file_name || c.label || c.fb_video_id || c.fb_image_hash}
                </p>
                <p className="text-[10px] text-gray-500 truncate">
                  {c.creative_type.toUpperCase()} ·{" "}
                  {new Date(c.uploaded_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
              <CheckCircle2 size={12} className="text-emerald-400" />
              <button
                type="button"
                onClick={() => handleDelete(c.id)}
                className="p-1 text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-400 cursor-pointer"
                title="Delete creative"
              >
                <Trash2 size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
