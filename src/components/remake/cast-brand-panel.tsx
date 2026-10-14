"use client";

import { Loader2, Plus, Trash2, UserCheck } from "lucide-react";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LOOKS } from "@/lib/hook-studio/presets";
import { PRODUCT_FORMS, type BrandKit, type ProjectView } from "@/lib/remake/types";
import { Button, ConfirmButton, Label, Panel, api } from "@/components/hook-studio/ui";

const field =
  "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";

/** Who appears in every shot, and which product they hold. */
export function CastBrandPanel({
  project,
  stores,
  onPatch,
  onKit,
  onError,
}: {
  project: ProjectView;
  stores: string[];
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onKit: (kit: BrandKit) => void;
  onError: (m: string) => void;
}) {
  const [rules, setRules] = useState(project.brand_kit?.rules ?? "");
  const [savingRules, setSavingRules] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const kit = project.brand_kit;
  const castShot = project.shots.find((s) => s.id === project.cast_shot_id);

  const saveRules = async () => {
    if (!project.store) return;
    setSavingRules(true);
    try {
      const r = await api<{ kit: BrandKit }>("/api/owner/remake/brand-kit", { method: "PUT", body: JSON.stringify({ store: project.store, rules }) });
      onKit(r.kit);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingRules(false);
    }
  };

  const uploadProduct = async (file: File) => {
    if (!project.store) return;
    setUploading(true);
    try {
      const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>("/api/owner/remake/upload-url", {
        method: "POST",
        body: JSON.stringify({ kind: "brand", mime: file.type, store: project.store }),
      });
      const up = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      const r = await api<{ kit: BrandKit }>("/api/owner/remake/brand-kit", { method: "POST", body: JSON.stringify({ store: project.store, path, label: file.name.slice(0, 80) }) });
      onKit(r.kit);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <Panel>
        <Label>Cast · one person for every shot</Label>
        <select value={project.cast_look} onChange={(e) => void onPatch({ cast_look: e.target.value })} className={field}>
          {LOOKS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <textarea
          defaultValue={project.cast_note}
          key={`${project.id}-castnote`}
          onBlur={(e) => e.target.value.trim() !== project.cast_note && void onPatch({ cast_note: e.target.value })}
          rows={2}
          placeholder="Optional: age range, vibe, hair… (e.g. late 20s, warm smile)"
          className={`${field} mt-2 resize-none`}
        />
        <div className="mt-3 flex items-center gap-2">
          {project.cast_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={project.cast_url} alt="" className="w-10 aspect-[9/16] object-cover rounded-md border border-purple-500" />
          ) : castShot?.still_preview_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={castShot.still_preview_url} alt="" className="w-10 aspect-[9/16] object-cover rounded-md border border-gray-700" />
          ) : (
            <div className="w-10 aspect-[9/16] rounded-md border border-dashed border-gray-700" />
          )}
          <div className="flex-1 min-w-0 text-xs">
            {project.cast_url ? (
              <>
                <p className="text-white inline-flex items-center gap-1">
                  <UserCheck size={12} className="text-green-400" /> Picked image
                </p>
                <p className="text-gray-500">Every still is generated with this person in the real frame.</p>
                <button type="button" onClick={() => void onPatch({ cast_path: null })} className="text-gray-400 hover:text-white cursor-pointer mt-0.5">
                  Remove
                </button>
              </>
            ) : castShot ? (
              <>
                <p className="text-white inline-flex items-center gap-1">
                  <UserCheck size={12} className="text-green-400" /> Locked to shot {castShot.idx + 1}
                </p>
                <p className="text-gray-500">New stills reuse this person.</p>
                <button type="button" onClick={() => void onPatch({ cast_shot_id: null })} className="text-gray-400 hover:text-white cursor-pointer mt-0.5">
                  Unlock
                </button>
              </>
            ) : (
              <p className="text-gray-500">Pick a person with &ldquo;Use existing image&rdquo; on any clip, or generate one still, approve it, and click &ldquo;Use this person as the cast&rdquo;.</p>
            )}
          </div>
        </div>
      </Panel>

      <Panel>
        <Label>Brand kit · our product</Label>
        <input
          list="remake-stores"
          defaultValue={project.store ?? ""}
          key={`${project.id}-store`}
          onBlur={(e) => e.target.value.trim() !== (project.store ?? "") && void onPatch({ store: e.target.value })}
          placeholder="Store (e.g. Glowry)"
          className={field}
        />
        <datalist id="remake-stores">
          {stores.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {!project.store ? (
          <p className="text-xs text-gray-500 mt-2">Set the store to attach product photos. Without them, competitor branding is only removed, not replaced.</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(kit?.images ?? []).map((img) => (
                <div key={img.id} className="min-w-0">
                <div className="relative group aspect-square rounded-md bg-gray-950 border border-gray-700 overflow-hidden">
                  {img.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img.url} alt={img.label ?? ""} className="w-full h-full object-cover" />
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 opacity-0 group-hover:opacity-100 flex justify-center py-0.5">
                    <ConfirmButton
                      question="Remove?"
                      onConfirm={async () => {
                        try {
                          const r = await api<{ kit: BrandKit }>(`/api/owner/remake/brand-kit?id=${img.id}`, { method: "DELETE" });
                          onKit(r.kit);
                        } catch (e) {
                          onError(e instanceof Error ? e.message : "Could not remove");
                        }
                      }}
                      className="text-gray-200 hover:text-red-300 cursor-pointer"
                    >
                      <Trash2 size={11} />
                    </ConfirmButton>
                  </div>
                </div>
                <select
                  value={img.kind ?? ""}
                  title={img.description ?? "What this photo shows"}
                  onChange={async (e) => {
                    try {
                      const r = await api<{ kit: BrandKit }>("/api/owner/remake/brand-kit", { method: "PATCH", body: JSON.stringify({ id: img.id, kind: e.target.value }) });
                      onKit(r.kit);
                    } catch (err) {
                      onError(err instanceof Error ? err.message : "Could not save");
                    }
                  }}
                  className={`mt-1 w-full bg-gray-900 border rounded-md px-1 py-0.5 text-[11px] focus:outline-none ${img.kind ? "border-gray-700 text-gray-300" : "border-amber-700 text-amber-300"}`}
                >
                  <option value="">unlabelled</option>
                  {PRODUCT_FORMS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || (kit?.images.length ?? 0) >= 6}
                className="aspect-square rounded-md border border-dashed border-gray-700 hover:border-purple-500 flex items-center justify-center text-gray-500 cursor-pointer disabled:opacity-40"
                title="Add a product photo"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadProduct(e.target.files[0])} />
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">One photo per form you sell: the bottle, the loose gummies or capsules, the box. The still swap picks the form that matches what the person holds.</p>
            {(kit?.images ?? []).some((i) => !i.kind) && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await api<{ kit: BrandKit }>("/api/owner/remake/brand-kit", { method: "PUT", body: JSON.stringify({ store: project.store, relabel: true }) });
                    onKit(r.kit);
                  } catch (err) {
                    onError(err instanceof Error ? err.message : "Could not label");
                  }
                }}
                className="mt-1 text-[11px] text-purple-300 hover:text-white cursor-pointer"
              >
                Label the unlabelled photos with Claude
              </button>
            )}
            <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={3} placeholder="Rules, e.g. keep the gold cap visible · no competitor text · US bathroom or kitchen settings" className={`${field} mt-3 resize-none`} />
            {rules !== (kit?.rules ?? "") && (
              <Button onClick={saveRules} busy={savingRules} className="mt-2">
                Save rules
              </Button>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
