"use client";

import { Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pickStaticAdPhotos } from "@/lib/image-studio/types";
import { PRODUCT_FORMS, type BrandImage, type BrandKit, type BrandKitSummary } from "@/lib/remake/types";
import { api } from "@/components/hook-studio/ui";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Note } from "@/components/ui/note";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Same tables and API the Clipper's brand kit panel uses, so both stay in step.
const ENDPOINT = "/api/owner/remake/brand-kit";
const MAX_PHOTOS = 8;
const PROFILE_MAX = 6000;
const RULES_MAX = 1500;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

const summarize = (k: BrandKit): BrandKitSummary => ({
  store: k.store,
  photos: k.images.length,
  unlabelled: k.images.filter((i) => !i.kind).length,
  has_profile: !!k.profile.trim(),
  has_rules: !!k.rules.trim(),
});

/** The headings FOLIQ's profile uses; the planner reads it as plain facts. */
const profileTemplate = (store: string) =>
  [
    `Brand: ${store} (website). Product: what it is, the form (bottle of gummies, capsules…), how many per pack, how to take it.`,
    "Audience: who buys it, their age, the problem they notice, what they have tried before.",
    "Price: selling price (regular price, discount). Shipping, guarantee.",
    "Social proof: rating, number of reviews, customers served.",
    "Core angle: the one idea that sets it apart from every other product.",
    "Proof points: the key ingredients and what each does; what it is free of.",
    "Benefit lines that work: short lines separated by ·",
    "Tone: how it talks (e.g. warm, mom-to-mom, English or Taglish). Never medical promises.",
    "Visual identity: the pack (colours, cap, label), the palette with hex codes, the light and surfaces, the headline type.",
    "Compliance: lines that must stay visible on the pack, claims we never make.",
  ].join("\n");

/**
 * Brand Kit: per brand, the product photos, the profile and the rules that
 * the Clipper, the Static Ad Generator and the Script Generator read. Was a
 * panel inside each Clipper project; this page is the place to fill it in.
 */
export function BrandKitPage() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [stores, setStores] = useState<BrandKitSummary[] | null>(null);
  const [store, setStore] = useState("");
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [profile, setProfile] = useState("");
  const [rules, setRules] = useState("");
  const [saving, setSaving] = useState<"profile" | "rules" | null>(null);
  const [labelling, setLabelling] = useState(false);
  const [uploads, setUploads] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const applyKit = useCallback((k: BrandKit) => {
    setKit(k);
    setStores((list) => list?.map((s) => (s.store === k.store ? summarize(k) : s)) ?? list);
  }, []);

  // The brand list, then the brand from ?store= (case-insensitive), else the first.
  useEffect(() => {
    let cancelled = false;
    api<{ stores: BrandKitSummary[] }>(ENDPOINT)
      .then((r) => {
        if (cancelled) return;
        setStores(r.stores);
        const wanted = (params.get("store") ?? "").toLowerCase();
        setStore(r.stores.find((s) => s.store.toLowerCase() === wanted)?.store ?? r.stores[0]?.store ?? "");
      })
      .catch((e) => !cancelled && setError(message(e, "Could not load the brands")));
    return () => {
      cancelled = true;
    };
    // Read ?store= once; later switches write it, they do not follow it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    api<{ kit: BrandKit }>(`${ENDPOINT}?store=${encodeURIComponent(store)}`)
      .then((r) => {
        if (cancelled) return;
        applyKit(r.kit);
        setProfile(r.kit.profile);
        setRules(r.kit.rules);
      })
      .catch((e) => !cancelled && setError(message(e, "Could not load the brand kit")));
    return () => {
      cancelled = true;
    };
  }, [store, applyKit]);

  const current = kit?.store === store ? kit : null;
  const profileDirty = !!current && profile !== current.profile;
  const rulesDirty = !!current && rules !== current.rules;
  const dirty = profileDirty || rulesDirty;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const pickStore = (next: string) => {
    if (next === store || uploads) return;
    if (dirty && !window.confirm("The profile or rules have unsaved changes. Leave them?")) return;
    setError(null);
    setStore(next);
    router.replace(`${pathname}?store=${encodeURIComponent(next)}`, { scroll: false });
  };

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!current || uploads) return;
      const images = files.filter((f) => IMAGE_TYPES.includes(f.type));
      const batch = images.slice(0, Math.max(0, MAX_PHOTOS - current.images.length));
      const notes: string[] = [];
      if (images.length < files.length) notes.push(`${files.length - images.length} skipped: only PNG, JPG or WebP`);
      if (batch.length < images.length) notes.push(`${images.length - batch.length} left out: ${MAX_PHOTOS} photos per brand at most`);
      setError(notes.length ? notes.join(" · ") : null);
      if (batch.length === 0) return;
      const target = current.store;
      setUploads({ done: 0, total: batch.length });
      try {
        for (const [i, file] of batch.entries()) {
          const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>("/api/owner/remake/upload-url", {
            method: "POST",
            body: JSON.stringify({ kind: "brand", mime: file.type, store: target }),
          });
          const up = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
          if (up.error) throw new Error(up.error.message);
          // Claude labels the form (bottle, gummies…) before this returns.
          const r = await api<{ kit: BrandKit }>(ENDPOINT, { method: "POST", body: JSON.stringify({ store: target, path, label: file.name.slice(0, 80) }) });
          applyKit(r.kit);
          setUploads({ done: i + 1, total: batch.length });
        }
      } catch (e) {
        setError(message(e, "Upload failed"));
      } finally {
        setUploads(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [current, uploads, applyKit]
  );

  // A screenshot pasted anywhere on the page is uploaded; pasted text is left alone.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      e.preventDefault();
      void uploadFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [uploadFiles]);

  const patchPhoto = async (id: string, body: { kind?: string; description?: string }) => {
    try {
      applyKit((await api<{ kit: BrandKit }>(ENDPOINT, { method: "PATCH", body: JSON.stringify({ id, ...body }) })).kit);
    } catch (e) {
      setError(message(e, "Could not save"));
    }
  };

  const removePhoto = async (id: string) => {
    try {
      applyKit((await api<{ kit: BrandKit }>(`${ENDPOINT}?id=${id}`, { method: "DELETE" })).kit);
    } catch (e) {
      setError(message(e, "Could not remove"));
    }
  };

  const relabel = async () => {
    if (!current) return;
    setLabelling(true);
    try {
      applyKit((await api<{ kit: BrandKit }>(ENDPOINT, { method: "PUT", body: JSON.stringify({ store: current.store, relabel: true }) })).kit);
    } catch (e) {
      setError(message(e, "Could not label"));
    } finally {
      setLabelling(false);
    }
  };

  const save = async (field: "profile" | "rules") => {
    if (!current) return;
    setSaving(field);
    try {
      const r = await api<{ kit: BrandKit }>(ENDPOINT, { method: "PUT", body: JSON.stringify({ store: current.store, [field]: field === "profile" ? profile : rules }) });
      applyKit(r.kit);
      // The server trims; take its copy so the field is clean again.
      if (field === "profile") setProfile(r.kit.profile);
      else setRules(r.kit.rules);
    } catch (e) {
      setError(message(e, "Could not save"));
    } finally {
      setSaving(null);
    }
  };

  const summary = stores?.find((s) => s.store === store) ?? null;
  const images = current?.images ?? [];
  const full = images.length >= MAX_PHOTOS;
  const { packs, contents } = pickStaticAdPhotos(images);
  const roleOf = (img: BrandImage) => (packs.includes(img) ? "pack" : contents.includes(img) ? "contents" : null);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Brand kit"
        subtitle="Product photos, profile and rules for each brand. The Clipper, the Static Ad Generator and the Script Generator all read from here."
      />

      {error && (
        <Note
          tone="bad"
          className="mb-4"
          actions={
            <Button size="sm" variant="ghost" onClick={() => setError(null)}>
              Dismiss
            </Button>
          }
        >
          {error}
        </Note>
      )}

      {stores === null ? (
        !error && (
          <p className="inline-flex items-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> Loading brands…
          </p>
        )
      ) : stores.length === 0 ? (
        <EmptyState title="No brands yet">Brands come from the active Shopify stores in Settings.</EmptyState>
      ) : (
        <>
          <div className="mb-4 overflow-x-auto">
            <Tabs tabs={stores.map((s) => ({ value: s.store, label: s.store, count: s.photos }))} value={store} onChange={pickStore} className="min-w-max" />
          </div>

          {summary && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Pill tone={summary.photos ? "good" : "warn"}>{summary.photos ? `${summary.photos} ${summary.photos === 1 ? "photo" : "photos"}` : "No photos"}</Pill>
              <Pill tone={summary.has_profile ? "good" : "warn"}>{summary.has_profile ? "Profile ready" : "No profile"}</Pill>
              <Pill tone={summary.has_rules ? "good" : "neutral"}>{summary.has_rules ? "Rules set" : "No rules"}</Pill>
              {summary.photos > 0 && summary.has_profile && (
                <span className="text-sm text-muted">
                  Ready for the{" "}
                  <Link href="/owner/image-studio" className="text-accent hover:underline">
                    Static Ad Generator
                  </Link>
                </span>
              )}
            </div>
          )}

          {!current ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted">
              <Loader2 size={14} className="animate-spin" /> Loading {store}…
            </p>
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <Panel
                title="Product photos"
                actions={
                  <span className="font-num text-xs text-muted">
                    {images.length} / {MAX_PHOTOS}
                  </span>
                }
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-disabled={full || !!uploads}
                  onClick={() => !full && !uploads && fileRef.current?.click()}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !full && !uploads && fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void uploadFiles(Array.from(e.dataTransfer.files));
                  }}
                  className={cn(
                    "grid justify-items-center gap-1 rounded-panel border border-dashed px-4 py-6 text-center transition-colors",
                    dragging ? "border-accent bg-accent-soft" : "border-line-strong hover:border-dim",
                    full || uploads ? "cursor-default" : "cursor-pointer",
                    full && "opacity-60"
                  )}
                >
                  {uploads ? <Loader2 size={18} className="animate-spin text-accent" /> : <Upload size={18} className="text-muted" />}
                  <p className="font-display text-sm text-fg">
                    {uploads
                      ? `Uploading ${Math.min(uploads.done + 1, uploads.total)} of ${uploads.total}…`
                      : full
                        ? `${MAX_PHOTOS} photos is the most a brand holds; remove one to add another`
                        : "Drop product photos here, paste a screenshot, or click to choose"}
                  </p>
                  <p className="text-xs text-muted">PNG, JPG or WebP, several at once. Claude labels each one (bottle, gummies, box…) as it lands.</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={IMAGE_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => e.target.files && void uploadFiles(Array.from(e.target.files))}
                />

                {images.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {images.map((img) => (
                      <PhotoCard key={img.id} img={img} role={roleOf(img)} onPatch={(body) => patchPhoto(img.id, body)} onRemove={() => removePhoto(img.id)} />
                    ))}
                  </div>
                )}

                {(summary?.unlabelled ?? 0) > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
                    {summary!.unlabelled} unlabelled
                    <Button size="sm" variant="secondary" onClick={() => void relabel()} disabled={labelling}>
                      {labelling ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Label with Claude
                    </Button>
                  </div>
                )}

                <p className="mt-3 text-xs text-muted">
                  One photo per form you sell, on a plain background: the bottle or pouch, the loose gummies or capsules, the box. The Static Ad Generator uses the first two pack photos and one contents photo (marked); the Clipper picks the form the person in the clip holds.
                </p>
              </Panel>

              <div className="grid gap-5">
                <Panel
                  title="Brand profile"
                  actions={
                    !profile.trim() && (
                      <Button size="sm" variant="secondary" onClick={() => setProfile(profileTemplate(store))}>
                        Start from template
                      </Button>
                    )
                  }
                >
                  <p className="mb-2 text-sm text-muted">
                    What the Static Ad Generator planner and the Script Generator know about the brand. They use only these facts, so put in the price, the proof points, the look and the compliance line.
                  </p>
                  <Textarea value={profile} onChange={(e) => setProfile(e.target.value)} rows={16} maxLength={PROFILE_MAX} placeholder="Product, price, audience, angle, proof points, tone, colours, compliance line…" className="leading-relaxed" />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-num text-xs text-dim">
                      {profile.length.toLocaleString("en-US")} / {PROFILE_MAX.toLocaleString("en-US")}
                    </span>
                    <Button size="sm" onClick={() => void save("profile")} disabled={!profileDirty || !!saving}>
                      {saving === "profile" && <Loader2 size={13} className="animate-spin" />} Save profile
                    </Button>
                  </div>
                </Panel>

                <Panel title="Rules">
                  <p className="mb-2 text-sm text-muted">Hard rules for every image and still made for this brand: what must always show, what never appears.</p>
                  <Textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={4} maxLength={RULES_MAX} placeholder="e.g. keep the gold cap visible · no competitor text · Filipino home settings" />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-num text-xs text-dim">
                      {rules.length.toLocaleString("en-US")} / {RULES_MAX.toLocaleString("en-US")}
                    </span>
                    <Button size="sm" onClick={() => void save("rules")} disabled={!rulesDirty || !!saving}>
                      {saving === "rules" && <Loader2 size={13} className="animate-spin" />} Save rules
                    </Button>
                  </div>
                </Panel>

                <Panel title="Model">
                  <p className="text-sm text-muted">
                    When the person library has a folder named <span className="font-mono text-fg">{store}</span>, static ads use its newest photo, and only when that person fits who the ad needs (a child stays a child). Without one, the planner casts someone who fits the reference and the profile. Folders live in the person library (Clipper, &ldquo;Use existing image&rdquo;).
                  </p>
                </Panel>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PhotoCard({
  img,
  role,
  onPatch,
  onRemove,
}: {
  img: BrandImage;
  role: "pack" | "contents" | null;
  onPatch: (body: { kind?: string; description?: string }) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="min-w-0 overflow-hidden rounded-panel border border-line bg-raised">
      <div className="relative aspect-square bg-canvas">
        {img.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img.url} alt={img.description ?? img.label ?? ""} className="h-full w-full object-contain" />
        )}
        {role && (
          <Tag tone="info" className="absolute left-1.5 top-1.5">
            Static ads · {role}
          </Tag>
        )}
      </div>
      <div className="grid gap-1.5 p-2">
        <Select value={img.kind ?? ""} onChange={(e) => void onPatch({ kind: e.target.value })} error={!img.kind} aria-label="What this photo shows">
          <option value="" disabled>
            Unlabelled
          </option>
          {PRODUCT_FORMS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
        <Input
          key={img.description ?? ""}
          defaultValue={img.description ?? ""}
          maxLength={160}
          placeholder="One line: what it shows"
          aria-label="Description"
          onBlur={(e) => e.target.value.trim() !== (img.description ?? "") && void onPatch({ description: e.target.value })}
          className="h-8 text-xs"
        />
        <div className="flex items-center justify-end gap-1.5">
          {confirming ? (
            <>
              <span className="text-xs text-bad">Remove?</span>
              <Button size="sm" variant="danger" onClick={() => void onRemove()}>
                Yes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                No
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              <Trash2 size={13} /> Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
