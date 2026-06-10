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
  ChevronDown,
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
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; ok: boolean; message: string };

const CTA_OPTIONS = [
  "LEARN_MORE",
  "SHOP_NOW",
  "SIGN_UP",
  "GET_OFFER",
  "ORDER_NOW",
  "CONTACT_US",
  "BOOK_NOW",
];

export default function FixRejectionsPage() {
  const [ads, setAds] = useState<RejectedAd[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fixStates, setFixStates] = useState<Record<string, FixState>>({});
  const [bulkRunning, setBulkRunning] = useState(false);

  // Why? feedback cache (ad_id → text)
  const [reasons, setReasons] = useState<Record<string, string>>({});

  // ── Safe images ──
  const [safeImages, setSafeImages] = useState<SafeImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fix settings (copy is auto-filled from the selected image's AI copy,
  //    editable if you want to tweak) ──
  const [headline, setHeadline] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [description, setDescription] = useState("");
  const [cta, setCta] = useState("LEARN_MORE");
  const [budget, setBudget] = useState(50);
  const [days, setDays] = useState(2);
  const [showCopy, setShowCopy] = useState(false);

  // ── Load rejected ads ──
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
      if (res.ok) {
        setSafeImages(json.images || []);
        setSelectedImageId((prev) => prev ?? json.images?.[0]?.id ?? null);
      }
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    loadAds();
    loadSafeImages();
  }, [loadAds, loadSafeImages]);

  // When the chosen image changes, load its AI copy into the editable fields.
  const selectedImage = useMemo(
    () => safeImages.find((i) => i.id === selectedImageId) || null,
    [safeImages, selectedImageId]
  );
  useEffect(() => {
    if (!selectedImage) return;
    setHeadline(selectedImage.ai_headline ?? "");
    setPrimaryText(selectedImage.ai_primary_text ?? "");
    setDescription(selectedImage.ai_description ?? "");
    setCta(selectedImage.ai_cta ?? "LEARN_MORE");
  }, [selectedImage]);

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

  // ── Selection ──
  const allSelected = ads.length > 0 && selected.size === ads.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(ads.map((a) => a.ad_id)));
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── Safe image upload (AI reads it + writes copy) ──
  const onUploadFile = async (file: File) => {
    const uploadAccount = accounts[0]?.id || ads[0]?.account_id;
    if (!uploadAccount) {
      alert("No ad account available yet — wait for the rejected ads to load.");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch("/api/facebook/safe-images", {
        method: "POST",
        headers: {
          "x-account-id": uploadAccount,
          "x-file-name": file.name,
          "x-file-content-type": file.type || "image/jpeg",
          "x-name": file.name.replace(/\.[^.]+$/, ""),
        },
        body: file,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      await loadSafeImages();
      setSelectedImageId(json.image?.id ?? null);
      if (json.image && !json.ai_generated) {
        alert(
          "Image uploaded, but AI couldn't write copy for it (check the Anthropic API key in Settings). You can type copy manually or hit Regenerate."
        );
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Upload failed");
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

  const deleteSafeImage = async (id: string) => {
    if (!confirm("Remove this safe image from the library?")) return;
    try {
      await fetch(`/api/facebook/safe-images?id=${id}`, { method: "DELETE" });
      await loadSafeImages();
      if (selectedImageId === id) setSelectedImageId(null);
    } catch {
      /* non-fatal */
    }
  };

  // ── Fix one ad ──
  const fixOne = useCallback(
    async (ad: RejectedAd): Promise<boolean> => {
      setFixStates((s) => ({ ...s, [ad.ad_id]: { kind: "running" } }));
      try {
        const res = await fetch("/api/facebook/fix-rejection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ad_id: ad.ad_id,
            ad_account_id: ad.account_id,
            safe_image_id: selectedImageId,
            // Copy is sent from the (AI-filled, possibly edited) fields.
            headline,
            primary_text: primaryText,
            description,
            cta,
            engagement_budget: budget,
            engagement_days: days,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Fix failed");
        const msg = json.engagement_applied
          ? `Fixed — re-submitted to Meta + ₱${budget}/${days}-day burst set.`
          : `Creative swapped + re-submitted. ${
              (json.warnings || []).join(" ") || "Engagement burst not applied."
            }`;
        setFixStates((s) => ({
          ...s,
          [ad.ad_id]: { kind: "done", ok: true, message: msg },
        }));
        return true;
      } catch (e) {
        setFixStates((s) => ({
          ...s,
          [ad.ad_id]: {
            kind: "done",
            ok: false,
            message: e instanceof Error ? e.message : "Fix failed",
          },
        }));
        return false;
      }
    },
    [selectedImageId, headline, primaryText, description, cta, budget, days]
  );

  const canFix = !!selectedImageId && headline.trim().length > 0;

  const fixSelected = async () => {
    if (!canFix) {
      alert("Pick a safe image (with AI copy) first.");
      return;
    }
    const targets = ads.filter((a) => selected.has(a.ad_id));
    if (!targets.length) return;
    if (
      !confirm(
        `Fix ${targets.length} rejected ad(s)? Each one's creative will be replaced with the safe image + AI copy and re-submitted to Meta.`
      )
    )
      return;
    setBulkRunning(true);
    for (const ad of targets) {
      await fixOne(ad);
    }
    setBulkRunning(false);
    loadAds(true);
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
        Just upload a safe image (a cat works great). The AI reads it and writes
        the headline, text, description, and CTA to drive harmless engagement —
        then it swaps that onto your disapproved ads, re-submits them to Meta,
        and runs a cheap ₱{budget}/{days}-day engagement burst. Same ad ID — no
        new campaign.
      </p>

      {/* ── Safe images + AI copy ── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <ImageIcon size={18} /> Safe image
          </h2>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded border border-emerald-600 disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Uploading + AI reading…
              </>
            ) : (
              <>
                <Upload size={13} /> Add image
              </>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadFile(f);
            }}
          />
        </div>

        {safeImages.length === 0 ? (
          <p className="text-xs text-gray-500 py-3">
            No safe images yet. Upload a cat (or any benign image) — the AI will
            write the copy for you.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3 mb-2">
            {safeImages.map((img) => (
              <div key={img.id} className="relative group">
                <button
                  onClick={() => setSelectedImageId(img.id)}
                  className={`block rounded-lg overflow-hidden border-2 ${
                    selectedImageId === img.id
                      ? "border-emerald-400"
                      : "border-transparent hover:border-gray-600"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.source_url}
                    alt={img.name}
                    className="w-24 h-24 object-cover bg-gray-800"
                  />
                </button>
                <button
                  onClick={() => deleteSafeImage(img.id)}
                  className="absolute top-1 right-1 p-1 bg-black/60 rounded opacity-0 group-hover:opacity-100"
                  title="Remove"
                >
                  <Trash2 size={12} className="text-red-400" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* AI copy preview for the selected image */}
        {selectedImage && (
          <div className="mt-3 border-t border-gray-800 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                <Sparkles size={13} />
                {selectedImage.ai_generated_at
                  ? "AI-written copy (used for the fix)"
                  : "No AI copy yet — regenerate or type below"}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => regenerateCopy(selectedImage.id)}
                  disabled={regeneratingId === selectedImage.id}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:underline disabled:opacity-50"
                >
                  {regeneratingId === selectedImage.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Wand2 size={12} />
                  )}
                  Regenerate
                </button>
                <button
                  onClick={() => setShowCopy((v) => !v)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200"
                >
                  <ChevronDown
                    size={13}
                    className={showCopy ? "rotate-180 transition" : "transition"}
                  />
                  {showCopy ? "Hide / edit" : "Edit copy"}
                </button>
              </div>
            </div>

            {!showCopy ? (
              <div className="text-xs text-gray-300 space-y-0.5">
                <div>
                  <span className="text-gray-500">Headline: </span>
                  {headline || <span className="text-gray-600">—</span>}
                </div>
                <div>
                  <span className="text-gray-500">Text: </span>
                  {primaryText || <span className="text-gray-600">—</span>}
                </div>
                <div>
                  <span className="text-gray-500">Description: </span>
                  {description || <span className="text-gray-600">—</span>}
                  <span className="text-gray-500"> · CTA: </span>
                  {cta.replace(/_/g, " ")}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400">Headline *</label>
                  <input
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    className="w-full mt-1 bg-gray-800 rounded px-3 py-2 text-sm border border-gray-700"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Call to action</label>
                  <select
                    value={cta}
                    onChange={(e) => setCta(e.target.value)}
                    className="w-full mt-1 bg-gray-800 rounded px-3 py-2 text-sm border border-gray-700"
                  >
                    {CTA_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-400">Primary text</label>
                  <textarea
                    value={primaryText}
                    onChange={(e) => setPrimaryText(e.target.value)}
                    rows={2}
                    className="w-full mt-1 bg-gray-800 rounded px-3 py-2 text-sm border border-gray-700"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-400">Description</label>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full mt-1 bg-gray-800 rounded px-3 py-2 text-sm border border-gray-700"
                  />
                </div>
              </div>
            )}
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
        <button
          onClick={fixSelected}
          disabled={!canFix || selected.size === 0 || bulkRunning}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {bulkRunning ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <ShieldCheck size={15} />
          )}
          Fix selected ({selected.size})
        </button>
      </div>

      {!canFix && (
        <div className="flex items-center gap-2 text-xs text-amber-400 mb-3">
          <AlertCircle size={14} />
          Upload or pick a safe image with AI copy to enable fixing.
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
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
                <th className="p-3 text-left">Ad</th>
                <th className="p-3 text-left">Account</th>
                <th className="p-3 text-left">Campaign / Ad set</th>
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
                        checked={selected.has(ad.ad_id)}
                        onChange={() => toggleOne(ad.ad_id)}
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
                        </span>
                      )}
                      {st?.kind === "done" && (
                        <span
                          className={st.ok ? "text-emerald-400" : "text-red-400"}
                        >
                          {st.message}
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
