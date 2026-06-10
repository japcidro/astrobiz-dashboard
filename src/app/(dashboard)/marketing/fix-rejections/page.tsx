"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ShieldCheck,
  Loader2,
  RefreshCw,
  Upload,
  Trash2,
  AlertCircle,
  CheckCircle2,
  ImageIcon,
  HelpCircle,
  Sparkles,
  Wand2,
  Pencil,
  Check,
  X,
  CircleStop,
} from "lucide-react";

// ── Types ──
interface RejectedAd {
  ad_id: string;
  account: string;
  account_id: string; // act_…
  campaign: string;
  adset: string;
  adset_id: string;
  ad: string; // ad name
  status: string;
}

interface AccountInfo {
  id: string;
  name: string;
}

interface SafeImage {
  id: string;
  name: string;
  source_url: string;
  created_at: string;
  ai_headline: string | null;
  ai_primary_text: string | null;
  ai_description: string | null;
  ai_cta: string | null;
  ai_generated_at: string | null;
}

type FixState =
  | { kind: "running"; image: string }
  | { kind: "done"; ok: boolean; message: string; image: string };

const CTA_OPTIONS = [
  "LEARN_MORE",
  "SHOP_NOW",
  "SIGN_UP",
  "GET_OFFER",
  "ORDER_NOW",
  "CONTACT_US",
  "BOOK_NOW",
];

// Map a raw FB status to a friendly running/stopped label + color.
function statusBadge(raw: string | undefined): { text: string; cls: string } {
  const s = (raw ?? "").toUpperCase();
  if (!s) return { text: "—", cls: "text-gray-600" };
  if (s.includes("DISAPPROV")) return { text: "Rejected", cls: "text-red-400" };
  if (s.includes("WITH_ISSUES")) return { text: "Issues", cls: "text-amber-400" };
  if (s.includes("PENDING") || s.includes("IN_PROCESS") || s.includes("REVIEW"))
    return { text: "In review", cls: "text-amber-400" };
  if (s.includes("PAUSED") || s.includes("ARCHIVED") || s.includes("DELETED"))
    return { text: "Stopped", cls: "text-gray-400" };
  if (s === "ACTIVE") return { text: "Running", cls: "text-emerald-400" };
  return { text: s, cls: "text-gray-400" };
}

// Shuffle helper (Fisher–Yates) — used to randomize image assignment.
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Downscale + re-encode to JPEG in the browser BEFORE upload. Phone photos
// are often 3-8MB (Vercel caps a function request body at ~4.5MB) and may be
// HEIC (which FB + Claude reject). This keeps every upload small and JPEG.
async function compressImage(file: File): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Couldn't read the file."));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () =>
      reject(
        new Error(
          "Browser can't open this image (HEIC?). Convert it to JPG or PNG first."
        )
      );
    im.src = dataUrl;
  });
  const maxDim = 1280;
  let { width, height } = img;
  if (Math.max(width, height) > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available in this browser.");
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85)
  );
  if (!blob) throw new Error("Image compression failed.");
  return blob;
}

export default function FixRejectionsPage() {
  const [ads, setAds] = useState<RejectedAd[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAds, setSelectedAds] = useState<Set<string>>(new Set());
  const [fixStates, setFixStates] = useState<Record<string, FixState>>({});
  const [bulkRunning, setBulkRunning] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  // Live FB delivery status per ad (overrides the loaded list status).
  const [liveStatus, setLiveStatus] = useState<Record<string, string>>({});
  const [loadingStatuses, setLoadingStatuses] = useState(false);

  // ── Safe-image library ──
  const [safeImages, setSafeImages] = useState<SafeImage[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadLog, setUploadLog] = useState<
    { name: string; ok: boolean; msg: string }[]
  >([]);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-image copy editor
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    headline: "",
    primary_text: "",
    description: "",
    cta: "LEARN_MORE",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Engagement burst (shared) ──
  const [budget, setBudget] = useState(70);
  const [days, setDays] = useState(2);

  // ── Loaders ──
  const loadAds = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/facebook/all-ads?date_preset=last_90d&account=ALL&include_zero_spend=1${
          refresh ? "&refresh=1" : ""
        }`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load ads");
      const rows = (json.data as RejectedAd[]) || [];
      const rejected = rows.filter((r) => r.status?.includes("DISAPPROVED"));
      const seen = new Set<string>();
      setAds(
        rejected.filter((r) => {
          if (seen.has(r.ad_id)) return false;
          seen.add(r.ad_id);
          return true;
        })
      );
      setAccounts((json.accounts as AccountInfo[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSafeImages = useCallback(async () => {
    try {
      const res = await fetch("/api/facebook/safe-images");
      const json = await res.json();
      if (res.ok) setSafeImages(json.images || []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    loadAds();
    loadSafeImages();
  }, [loadAds, loadSafeImages]);

  // ── Why? (rejection reason) ──
  const loadReason = useCallback(async (adId: string) => {
    setReasons((r) => ({ ...r, [adId]: "Loading…" }));
    try {
      const res = await fetch(
        `/api/facebook/ad-review-feedback?ad_id=${encodeURIComponent(adId)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      const lines = [
        ...(json.policies || []).map(
          (p: { policy: string; description: string }) =>
            `• ${p.policy}${p.description ? ` — ${p.description}` : ""}`
        ),
        ...(json.issues || []).map(
          (i: { summary: string | null; message: string | null }) =>
            `• ${i.summary || i.message || ""}`
        ),
      ].filter(Boolean);
      setReasons((r) => ({
        ...r,
        [adId]: lines.length ? lines.join("\n") : "No specific reason returned by Meta.",
      }));
    } catch (e) {
      setReasons((r) => ({
        ...r,
        [adId]: e instanceof Error ? e.message : "Failed to load reason",
      }));
    }
  }, []);

  // ── Live status refresh (batch) ──
  const refreshStatuses = useCallback(async (ids: string[]) => {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return;
    setLoadingStatuses(true);
    try {
      const res = await fetch(
        `/api/facebook/ad-statuses?ad_ids=${encodeURIComponent(unique.join(","))}`
      );
      const json = await res.json();
      if (res.ok && json.statuses) {
        setLiveStatus((s) => ({ ...s, ...json.statuses }));
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoadingStatuses(false);
    }
  }, []);

  // ── Ad selection ──
  const allAdsSelected = ads.length > 0 && selectedAds.size === ads.length;
  const toggleAllAds = () =>
    setSelectedAds(allAdsSelected ? new Set() : new Set(ads.map((a) => a.ad_id)));
  const toggleAd = (id: string) =>
    setSelectedAds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── Image selection ──
  const toggleImage = (id: string) =>
    setSelectedImageIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAllImages = () =>
    setSelectedImageIds(new Set(safeImages.map((i) => i.id)));
  const clearImages = () => setSelectedImageIds(new Set());

  // ── Upload (AI reads it + writes copy) ──
  const onUploadFiles = async (files: FileList) => {
    const uploadAccount = accounts[0]?.id || ads[0]?.account_id;
    if (!uploadAccount) {
      alert("No ad account available yet — wait for the rejected ads to load.");
      return;
    }
    setUploading(true);
    setUploadLog([]);
    const newIds: string[] = [];
    const log: { name: string; ok: boolean; msg: string }[] = [];
    try {
      for (const file of Array.from(files)) {
        const baseName = file.name.replace(/\.[^.]+$/, "");
        try {
          // Shrink + normalize to JPEG client-side (avoids the 4.5MB body
          // limit and HEIC issues).
          const blob = await compressImage(file);
          const res = await fetch("/api/facebook/safe-images", {
            method: "POST",
            headers: {
              "x-account-id": uploadAccount,
              "x-file-name": `${baseName}.jpg`,
              "x-file-content-type": "image/jpeg",
              "x-name": baseName,
            },
            body: blob,
          });
          const json = await res.json();
          if (!res.ok) {
            log.push({ name: file.name, ok: false, msg: json.error || `HTTP ${res.status}` });
            continue;
          }
          if (json.image?.id) newIds.push(json.image.id);
          log.push({
            name: file.name,
            ok: true,
            msg: json.ai_generated ? "uploaded + AI copy" : "uploaded (no AI copy — regenerate)",
          });
        } catch (e) {
          log.push({
            name: file.name,
            ok: false,
            msg: e instanceof Error ? e.message : "failed",
          });
        }
        setUploadLog([...log]);
      }
      await loadSafeImages();
      if (newIds.length) {
        setSelectedImageIds((s) => new Set([...s, ...newIds]));
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const regenerateCopy = async (id: string) => {
    setRegeneratingId(id);
    try {
      const res = await fetch("/api/facebook/safe-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Regenerate failed");
      await loadSafeImages();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Regenerate failed");
    } finally {
      setRegeneratingId(null);
    }
  };

  const startEdit = (img: SafeImage) => {
    setEditingId(img.id);
    setEditDraft({
      headline: img.ai_headline ?? "",
      primary_text: img.ai_primary_text ?? "",
      description: img.ai_description ?? "",
      cta: img.ai_cta ?? "LEARN_MORE",
    });
  };

  const saveEdit = async (id: string) => {
    if (!editDraft.headline.trim()) {
      alert("Headline can't be empty.");
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch("/api/facebook/safe-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, copy: editDraft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      await loadSafeImages();
      setEditingId(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteSafeImage = async (id: string) => {
    if (!confirm("Remove this safe image from the library?")) return;
    try {
      await fetch(`/api/facebook/safe-images?id=${id}`, { method: "DELETE" });
      await loadSafeImages();
      setSelectedImageIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    } catch {
      /* non-fatal */
    }
  };

  // Selected images that actually have copy (usable for a fix).
  const usableImages = useMemo(
    () => safeImages.filter((i) => selectedImageIds.has(i.id) && i.ai_headline),
    [safeImages, selectedImageIds]
  );

  const canFix = usableImages.length > 0 && selectedAds.size > 0;

  // ── Bulk fix: assign a random image per ad, no repeats until the pool
  //    of selected images is exhausted (then it cycles with a reshuffle). ──
  const fixSelected = async () => {
    if (usableImages.length === 0) {
      alert("Select at least one library image that has copy.");
      return;
    }
    const targets = ads.filter((a) => selectedAds.has(a.ad_id));
    if (!targets.length) return;
    if (
      !confirm(
        `Fix ${targets.length} ad(s) using ${usableImages.length} image(s)? Each ad gets a random image (no repeats until the images run out), re-submitted to Meta with that image's copy.`
      )
    )
      return;

    // Precompute assignments.
    const assignment: Record<string, SafeImage> = {};
    let pool: SafeImage[] = [];
    for (const ad of targets) {
      if (pool.length === 0) pool = shuffle(usableImages);
      assignment[ad.ad_id] = pool.pop()!;
    }

    setBulkRunning(true);
    for (const ad of targets) {
      const img = assignment[ad.ad_id];
      setFixStates((s) => ({
        ...s,
        [ad.ad_id]: { kind: "running", image: img.name },
      }));
      try {
        const res = await fetch("/api/facebook/fix-rejection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ad_id: ad.ad_id,
            ad_account_id: ad.account_id,
            safe_image_id: img.id,
            // No copy sent — the route uses this image's AI copy.
            engagement_budget: budget,
            engagement_days: days,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Fix failed");
        const appliedBudget = json.applied_budget ?? budget;
        const msg = json.engagement_applied
          ? `Fixed — re-submitted + ₱${appliedBudget}/${days}-day burst.`
          : `Swapped + re-submitted. ${
              (json.warnings || []).join(" ") || "Burst not applied."
            }`;
        setFixStates((s) => ({
          ...s,
          [ad.ad_id]: { kind: "done", ok: true, message: msg, image: img.name },
        }));
      } catch (e) {
        setFixStates((s) => ({
          ...s,
          [ad.ad_id]: {
            kind: "done",
            ok: false,
            message: e instanceof Error ? e.message : "Fix failed",
            image: img.name,
          },
        }));
      }
    }
    setBulkRunning(false);
    // Pull live status for the fixed ads so the Status column updates
    // (they'll show "In review" right after re-submission). We don't reload
    // the disapproved list, so fixed rows stay visible for monitoring.
    refreshStatuses(targets.map((t) => t.ad_id));
  };

  // ── Stop (pause) selected ads immediately ──
  const [stopping, setStopping] = useState(false);
  const stopSelected = async () => {
    const ids = ads.filter((a) => selectedAds.has(a.ad_id)).map((a) => a.ad_id);
    if (ids.length === 0) return;
    if (!confirm(`Stop (pause) ${ids.length} ad(s) now?`)) return;
    setStopping(true);
    try {
      const res = await fetch("/api/facebook/pause-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_ids: ids, status: "PAUSED" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Stop failed");
      const failed = Object.entries(
        (json.results ?? {}) as Record<string, { ok: boolean; error?: string }>
      ).filter(([, v]) => !v.ok);
      if (failed.length) {
        alert(
          `${failed.length} ad(s) couldn't be stopped:\n` +
            failed.map(([id, v]) => `${id}: ${v.error}`).join("\n")
        );
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Stop failed");
    } finally {
      setStopping(false);
      refreshStatuses(ids);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <ShieldCheck className="text-emerald-400" size={26} />
          <h1 className="text-2xl font-bold">Fix Rejections</h1>
        </div>
        <button
          onClick={() => loadAds(true)}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
      <p className="text-sm text-gray-400 mb-6 max-w-3xl">
        Upload safe images once — they stay in your library with AI-written copy.
        Pick several, select your rejected ads, and Fix: each ad gets a random
        image (no repeats until the pool runs out), re-submitted to Meta with a
        ₱{budget}/{days}-day engagement burst. Same ad ID — no new campaign.
      </p>

      {/* ── Library ── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-semibold flex items-center gap-2">
            <ImageIcon size={18} /> Image library
            <span className="text-gray-500 font-normal text-sm">
              ({selectedImageIds.size} selected)
            </span>
          </h2>
          <div className="flex items-center gap-2">
            {safeImages.length > 0 && (
              <>
                <button
                  onClick={selectAllImages}
                  className="text-xs px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700"
                >
                  Select all
                </button>
                <button
                  onClick={clearImages}
                  className="text-xs px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700"
                >
                  Clear
                </button>
              </>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded border border-emerald-600 disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Uploading + AI…
                </>
              ) : (
                <>
                  <Upload size={13} /> Add images
                </>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onUploadFiles(e.target.files);
              }}
            />
          </div>
        </div>

        {uploadLog.length > 0 && (
          <div className="mb-3 text-xs space-y-0.5 bg-gray-800/40 border border-gray-800 rounded p-2 max-h-40 overflow-auto">
            {uploadLog.map((l, i) => (
              <div
                key={i}
                className={l.ok ? "text-emerald-400" : "text-red-400"}
              >
                {l.ok ? "✓" : "✕"} {l.name} — {l.msg}
              </div>
            ))}
          </div>
        )}

        {safeImages.length === 0 ? (
          <p className="text-xs text-gray-500 py-3">
            No images yet. Upload one or many cats (or any benign images) — the
            AI writes the copy for each, and they stay here for next time.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {safeImages.map((img) => {
              const isSel = selectedImageIds.has(img.id);
              const isEditing = editingId === img.id;
              return (
                <div
                  key={img.id}
                  className={`rounded-lg border p-3 ${
                    isSel
                      ? "border-emerald-500 bg-emerald-500/5"
                      : "border-gray-800 bg-gray-800/30"
                  }`}
                >
                  <div className="flex gap-3">
                    <button
                      onClick={() => toggleImage(img.id)}
                      className="relative shrink-0"
                      title={isSel ? "Selected" : "Click to select"}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.source_url}
                        alt={img.name}
                        className="w-20 h-20 object-cover rounded bg-gray-800"
                      />
                      {isSel && (
                        <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 rounded-full p-0.5">
                          <Check size={12} className="text-white" />
                        </span>
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{img.name}</div>
                      {img.ai_headline ? (
                        <div className="text-[11px] text-gray-400 mt-0.5 line-clamp-3">
                          <span className="text-emerald-400">{img.ai_headline}</span>
                          {img.ai_primary_text ? ` — ${img.ai_primary_text}` : ""}
                        </div>
                      ) : (
                        <div className="text-[11px] text-amber-400 mt-0.5">
                          No copy yet — Regenerate or Edit.
                        </div>
                      )}
                    </div>
                  </div>

                  {!isEditing ? (
                    <div className="flex items-center gap-3 mt-2 text-[11px]">
                      <button
                        onClick={() => regenerateCopy(img.id)}
                        disabled={regeneratingId === img.id}
                        className="flex items-center gap-1 text-blue-400 hover:underline disabled:opacity-50"
                      >
                        {regeneratingId === img.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Wand2 size={11} />
                        )}
                        Regenerate
                      </button>
                      <button
                        onClick={() => startEdit(img)}
                        className="flex items-center gap-1 text-gray-400 hover:text-gray-200"
                      >
                        <Pencil size={11} /> Edit
                      </button>
                      <button
                        onClick={() => deleteSafeImage(img.id)}
                        className="flex items-center gap-1 text-red-400 hover:underline ml-auto"
                      >
                        <Trash2 size={11} /> Remove
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      <input
                        value={editDraft.headline}
                        onChange={(e) =>
                          setEditDraft((d) => ({ ...d, headline: e.target.value }))
                        }
                        placeholder="Headline *"
                        className="w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700"
                      />
                      <textarea
                        value={editDraft.primary_text}
                        onChange={(e) =>
                          setEditDraft((d) => ({ ...d, primary_text: e.target.value }))
                        }
                        rows={2}
                        placeholder="Primary text"
                        className="w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700"
                      />
                      <input
                        value={editDraft.description}
                        onChange={(e) =>
                          setEditDraft((d) => ({ ...d, description: e.target.value }))
                        }
                        placeholder="Description"
                        className="w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700"
                      />
                      <div className="flex items-center gap-2">
                        <select
                          value={editDraft.cta}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, cta: e.target.value }))
                          }
                          className="bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700 flex-1"
                        >
                          {CTA_OPTIONS.map((c) => (
                            <option key={c} value={c}>
                              {c.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => saveEdit(img.id)}
                          disabled={savingEdit}
                          className="flex items-center gap-1 text-xs px-2 py-1 bg-emerald-600 hover:bg-emerald-500 rounded disabled:opacity-50"
                        >
                          {savingEdit ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Check size={11} />
                          )}
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex items-center gap-1 text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Engagement burst settings */}
        <div className="grid grid-cols-2 gap-4 mt-4 border-t border-gray-800 pt-4 max-w-md">
          <div>
            <label className="text-xs text-gray-400">
              Engagement budget (₱/day)
            </label>
            <input
              type="number"
              min={1}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 rounded px-3 py-2 text-sm border border-gray-700"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">Run for (days)</label>
            <input
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 rounded px-3 py-2 text-sm border border-gray-700"
            />
          </div>
        </div>
      </div>

      {/* ── Rejected ads ── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">
          Rejected ads{" "}
          <span className="text-gray-500 font-normal">({ads.length})</span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshStatuses(ads.map((a) => a.ad_id))}
            disabled={loadingStatuses || ads.length === 0}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-40"
            title="Check live delivery status of these ads"
          >
            <RefreshCw size={14} className={loadingStatuses ? "animate-spin" : ""} />
            Refresh statuses
          </button>
          <button
            onClick={stopSelected}
            disabled={stopping || selectedAds.size === 0}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-red-900/70 hover:bg-red-800 text-red-100 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            title="Pause the selected ads immediately"
          >
            {stopping ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CircleStop size={14} />
            )}
            Stop selected ({selectedAds.size})
          </button>
          <button
            onClick={fixSelected}
            disabled={!canFix || bulkRunning}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {bulkRunning ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Sparkles size={15} />
            )}
            Fix selected ({selectedAds.size})
          </button>
        </div>
      </div>

      {!canFix && (
        <div className="flex items-center gap-2 text-xs text-amber-400 mb-3">
          <AlertCircle size={14} />
          Select at least one library image (with copy) and one rejected ad.
        </div>
      )}

      {error && (
        <div className="bg-red-900/40 border border-red-800 text-red-200 rounded-lg p-3 text-sm mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-10 justify-center">
          <Loader2 className="animate-spin" size={18} /> Loading rejected ads…
        </div>
      ) : ads.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <CheckCircle2 className="mx-auto mb-2 text-emerald-500" size={28} />
          No disapproved ads in the last 90 days. 🎉
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/60 text-gray-400 text-xs uppercase">
              <tr>
                <th className="p-3 w-10">
                  <input
                    type="checkbox"
                    checked={allAdsSelected}
                    onChange={toggleAllAds}
                  />
                </th>
                <th className="p-3 text-left">Ad</th>
                <th className="p-3 text-left">Account</th>
                <th className="p-3 text-left">Campaign / Ad set</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Reason</th>
                <th className="p-3 text-left">Result</th>
              </tr>
            </thead>
            <tbody>
              {ads.map((ad) => {
                const st = fixStates[ad.ad_id];
                return (
                  <tr
                    key={ad.ad_id}
                    className="border-t border-gray-800 hover:bg-gray-800/30 align-top"
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selectedAds.has(ad.ad_id)}
                        onChange={() => toggleAd(ad.ad_id)}
                      />
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{ad.ad || "(unnamed)"}</div>
                      <div className="text-xs text-gray-500">{ad.ad_id}</div>
                    </td>
                    <td className="p-3 text-gray-300">{ad.account}</td>
                    <td className="p-3 text-gray-400 text-xs">
                      <div>{ad.campaign}</div>
                      <div className="text-gray-600">{ad.adset}</div>
                    </td>
                    <td className="p-3 text-xs">
                      {(() => {
                        const b = statusBadge(liveStatus[ad.ad_id] ?? ad.status);
                        return (
                          <span className={`font-medium ${b.cls}`}>● {b.text}</span>
                        );
                      })()}
                    </td>
                    <td className="p-3 text-xs max-w-xs">
                      {reasons[ad.ad_id] ? (
                        <pre className="whitespace-pre-wrap font-sans text-gray-400">
                          {reasons[ad.ad_id]}
                        </pre>
                      ) : (
                        <button
                          onClick={() => loadReason(ad.ad_id)}
                          className="flex items-center gap-1 text-blue-400 hover:underline"
                        >
                          <HelpCircle size={12} /> Why?
                        </button>
                      )}
                    </td>
                    <td className="p-3 text-xs">
                      {!st && <span className="text-gray-600">—</span>}
                      {st?.kind === "running" && (
                        <span className="flex items-center gap-1 text-blue-400">
                          <Loader2 size={12} className="animate-spin" /> Fixing…
                          <span className="text-gray-500">({st.image})</span>
                        </span>
                      )}
                      {st?.kind === "done" && (
                        <span className={st.ok ? "text-emerald-400" : "text-red-400"}>
                          {st.message}{" "}
                          <span className="text-gray-500">· {st.image}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
