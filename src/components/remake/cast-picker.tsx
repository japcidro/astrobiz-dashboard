"use client";

import { ArrowLeft, Check, ChevronRight, Folder, FolderPlus, Loader2, MoreHorizontal, Pencil, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CastSource, Person, PersonFolder, PersonLibrary } from "@/lib/remake/types";
import { Button, api, timeAgo } from "@/components/hook-studio/ui";

const ACCEPT = "image/png,image/jpeg,image/webp";
const IMAGE_TYPES = new Set(ACCEPT.split(","));
/** dataTransfer type for a person card being dragged onto a folder. */
const PERSON_DRAG = "application/x-remake-person";
const UPLOAD_PARALLEL = 3;

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
const hasPerson = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(PERSON_DRAG);
const stripExt = (name: string) => name.replace(/\.[a-z0-9]+$/i, "");

/**
 * Full-screen chooser for the person who goes into every clip. The library
 * is folders (FOLIQ, Momentum, …) of people: UGC Generator images and
 * uploaded photos. Photos dropped anywhere on the modal upload into the open
 * folder; a person card drags onto a folder to move. One click selects, the
 * bottom bar confirms.
 */
export function CastPicker({
  current,
  onPick,
  onClose,
}: {
  /** Kept for callers; uploads now land in the library, not the project. */
  projectId?: string;
  /** Signed URL of the person already picked, if any. */
  current: string | null;
  onPick: (body: CastSource) => Promise<void>;
  onClose: () => void;
}) {
  const [lib, setLib] = useState<PersonLibrary | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState<"pick" | "folder" | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Drag state: files over the modal (count = items being dragged), the folder card under the pointer, the person being dragged.
  const [filesOver, setFilesOver] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);
  const [dragPerson, setDragPerson] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: "new" | "rename"; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const load = useCallback(async () => {
    try {
      setLib(await api<PersonLibrary>("/api/owner/remake/library"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the library");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuFor) setMenuFor(null);
      else if (editing) setEditing(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, menuFor, editing]);

  const folders = useMemo(() => lib?.folders ?? [], [lib]);
  const people = useMemo(() => lib?.people ?? [], [lib]);
  const folder = useMemo(() => folders.find((f) => f.id === open) ?? null, [folders, open]);
  const here = useMemo(() => people.filter((p) => p.folder_id === open), [people, open]);
  const inFolder = useCallback((id: string) => people.filter((p) => p.folder_id === id), [people]);
  const hereName = folder?.name ?? "Unsorted";

  // ─── Selection ───

  const confirm = async () => {
    if (!chosen) return;
    setBusy("pick");
    setError(null);
    try {
      await onPick({ person_id: chosen });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use this person");
      setBusy(null);
    }
  };

  // ─── Uploads ───

  /** Upload photos into a folder (null = Unsorted), a few at a time; a single new photo is pre-selected. */
  const uploadFiles = async (list: FileList | File[], folderId: string | null) => {
    const files = Array.from(list).filter((f) => IMAGE_TYPES.has(f.type));
    if (files.length === 0) {
      setError("Drop PNG, JPG or WebP photos");
      return;
    }
    setError(null);
    setUploading({ done: 0, total: files.length });
    const ids: string[] = [];
    const failures: string[] = [];
    const supabase = createClient();
    const one = async (file: File) => {
      try {
        const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>("/api/owner/remake/upload-url", {
          method: "POST",
          body: JSON.stringify({ kind: "person", mime: file.type }),
        });
        const up = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (up.error) throw new Error(up.error.message);
        const { id } = await api<{ id: string }>("/api/owner/remake/library/people", {
          method: "POST",
          body: JSON.stringify({ path, name: stripExt(file.name), folder_id: folderId }),
        });
        ids.push(id);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading((u) => (u ? { ...u, done: u.done + 1 } : u));
      }
    };
    const queue = [...files];
    await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL, queue.length) }, async () => {
      while (queue.length) await one(queue.shift()!);
    }));
    await load();
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
    if (failures.length) setError(`${failures.length} of ${files.length} failed: ${failures[0]}`);
    if (ids.length === 1) setChosen(ids[0]);
  };

  // ─── Folders ───

  const saveFolder = async () => {
    const name = editing?.name.trim() ?? "";
    if (!editing || !name) return;
    setBusy("folder");
    setError(null);
    try {
      if (editing.kind === "new") {
        const { folder: created } = await api<{ folder: PersonFolder }>("/api/owner/remake/library/folders", { method: "POST", body: JSON.stringify({ name }) });
        setLib((l) => (l ? { ...l, folders: [...l.folders, created].sort((a, b) => a.name.localeCompare(b.name)) } : l));
        setOpen(created.id);
      } else if (folder) {
        const { folder: renamed } = await api<{ folder: PersonFolder }>(`/api/owner/remake/library/folders/${folder.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
        setLib((l) => (l ? { ...l, folders: l.folders.map((f) => (f.id === renamed.id ? renamed : f)).sort((a, b) => a.name.localeCompare(b.name)) } : l));
      }
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the folder");
    } finally {
      setBusy(null);
    }
  };

  const deleteFolder = async () => {
    if (!folder) return;
    setBusy("folder");
    setError(null);
    try {
      await api(`/api/owner/remake/library/folders/${folder.id}`, { method: "DELETE" });
      setLib((l) => (l ? { ...l, folders: l.folders.filter((f) => f.id !== folder.id) } : l));
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the folder");
    } finally {
      setBusy(null);
    }
  };

  const movePerson = async (id: string, folderId: string | null) => {
    setMenuFor(null);
    const before = lib;
    setLib((l) => (l ? { ...l, people: l.people.map((p) => (p.id === id ? { ...p, folder_id: folderId } : p)) } : l));
    try {
      await api(`/api/owner/remake/library/people/${id}`, { method: "PATCH", body: JSON.stringify({ folder_id: folderId }) });
    } catch (e) {
      setLib(before);
      setError(e instanceof Error ? e.message : "Could not move the person");
    }
  };

  // ─── Drag and drop ───

  const onModalDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setFilesOver(e.dataTransfer.items?.length || 1);
  };
  const onModalDragOver = (e: DragEvent) => {
    if (hasFiles(e) || hasPerson(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = hasFiles(e) ? "copy" : "move";
    }
  };
  const onModalDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setFilesOver(null);
      setDropTarget(null);
    }
  };
  const resetDrag = () => {
    dragDepth.current = 0;
    setFilesOver(null);
    setDropTarget(null);
    setDragPerson(null);
  };
  const onModalDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const files = e.dataTransfer.files;
    resetDrag();
    void uploadFiles(files, open);
  };

  /** A folder card (or the "All people" crumb, target "root") takes dropped photos and dragged people. */
  const targetProps = (target: string | "root") => ({
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e) && !hasPerson(e)) return;
      e.preventDefault();
      if (dropTarget !== target) setDropTarget(target);
    },
    onDragLeave: () => setDropTarget((t) => (t === target ? null : t)),
    onDrop: (e: DragEvent) => {
      const folderId = target === "root" ? null : target;
      if (hasFiles(e)) {
        e.preventDefault();
        e.stopPropagation();
        const files = e.dataTransfer.files;
        resetDrag();
        void uploadFiles(files, folderId);
      } else if (hasPerson(e)) {
        e.preventDefault();
        const id = e.dataTransfer.getData(PERSON_DRAG);
        resetDrag();
        if (id) void movePerson(id, folderId);
      }
    },
  });

  const dropLabel = dropTarget && dropTarget !== "root" ? folders.find((f) => f.id === dropTarget)?.name ?? hereName : dropTarget === "root" ? "Unsorted" : hereName;

  // ─── Render ───

  const renderPerson = (p: Person) => {
    const on = chosen === p.id;
    const others = folders.filter((f) => f.id !== p.folder_id);
    return (
      <div key={p.id} className="relative group">
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(PERSON_DRAG, p.id);
            e.dataTransfer.effectAllowed = "move";
            setDragPerson(p.id);
            setMenuFor(null);
          }}
          onDragEnd={() => setDragPerson(null)}
          onClick={() => setChosen(on ? null : p.id)}
          className={`w-full text-left rounded-xl p-1 transition-colors cursor-pointer ${on ? "bg-purple-600/30 ring-2 ring-purple-500" : "hover:bg-white/5"} ${dragPerson === p.id ? "opacity-40" : ""}`}
        >
          <div className="relative aspect-[9/16] rounded-lg overflow-hidden bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="w-full h-full object-cover pointer-events-none" loading="lazy" draggable={false} />
            {on && (
              <span className="absolute top-1.5 right-1.5 bg-purple-600 text-white rounded-full p-1">
                <Check size={12} />
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5 truncate" title={p.name}>
            {p.name || (p.ugc_job_id ? "UGC image" : "Photo")}
          </p>
          <p className="text-[10px] text-gray-600">{timeAgo(p.created_at)}</p>
        </button>
        <button
          type="button"
          aria-label="Move to folder"
          title="Move to folder"
          onClick={(e) => {
            e.stopPropagation();
            setMenuFor(menuFor === p.id ? null : p.id);
          }}
          className={`absolute top-2.5 left-2.5 rounded-md bg-black/60 text-white p-0.5 cursor-pointer transition-opacity ${menuFor === p.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100"}`}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuFor === p.id && (
          <div className="absolute top-8 left-2.5 z-20 min-w-40 rounded-lg bg-gray-900 border border-gray-700 shadow-xl py-1 text-xs" role="menu">
            <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500">Move to</p>
            {p.folder_id !== null && (
              <button type="button" role="menuitem" onClick={() => void movePerson(p.id, null)} className="w-full text-left px-3 py-1.5 text-gray-200 hover:bg-white/10 cursor-pointer">
                Unsorted
              </button>
            )}
            {others.map((f) => (
              <button key={f.id} type="button" role="menuitem" onClick={() => void movePerson(p.id, f.id)} className="w-full text-left px-3 py-1.5 text-gray-200 hover:bg-white/10 cursor-pointer truncate">
                {f.name}
              </button>
            ))}
            {others.length === 0 && p.folder_id === null && <p className="px-3 py-1.5 text-gray-500">No folders yet</p>}
          </div>
        )}
      </div>
    );
  };

  const renderFolder = (f: PersonFolder) => {
    const inside = inFolder(f.id);
    const covers = inside.slice(0, 4);
    const hot = dropTarget === f.id;
    return (
      <button
        key={f.id}
        type="button"
        onClick={() => setOpen(f.id)}
        {...targetProps(f.id)}
        className={`text-left rounded-xl p-2.5 border transition-colors cursor-pointer ${hot ? "border-purple-500 ring-2 ring-purple-500/40 bg-purple-600/15" : "border-gray-800 bg-gray-900/60 hover:bg-gray-900"}`}
      >
        <div className="pointer-events-none">
          <div className="grid grid-cols-2 gap-0.5 aspect-square rounded-lg overflow-hidden bg-black">
            {covers.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" />
            ))}
            {covers.length === 0 && (
              <div className="col-span-2 flex items-center justify-center text-gray-600">
                <Folder size={28} />
              </div>
            )}
          </div>
          <div className="flex items-baseline justify-between gap-2 mt-2">
            <p className="text-sm font-semibold text-white truncate">{f.name}</p>
            <span className="text-[11px] text-gray-500 shrink-0">{inside.length}</span>
          </div>
        </div>
      </button>
    );
  };

  const grid = "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Pick the person">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      {menuFor && <div className="absolute inset-0" onClick={() => setMenuFor(null)} />}
      <div
        className="relative w-full max-w-5xl h-[90vh] flex flex-col rounded-2xl bg-gray-950 border border-gray-800 shadow-2xl overflow-hidden"
        onDragEnter={onModalDragEnter}
        onDragOver={onModalDragOver}
        onDragLeave={onModalDragLeave}
        onDrop={onModalDrop}
      >
        <div className="flex items-start gap-3 p-5 border-b border-gray-800 shrink-0">
          <div className="flex-1">
            <h2 className="text-lg font-bold text-white">Pick the person</h2>
            <p className="text-sm text-gray-400 mt-0.5">They go into every clip&apos;s real frame. The still is generated from the frame with this person in it.</p>
          </div>
          {current && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current} alt="" className="w-8 aspect-[9/16] object-cover rounded border border-purple-500" />
              Current
            </div>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white cursor-pointer p-1">
            <X size={18} />
          </button>
        </div>

        {/* Breadcrumb + folder actions */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-gray-800/70 text-sm min-h-12 shrink-0">
          {folder ? (
            <>
              <button
                type="button"
                onClick={() => setOpen(null)}
                {...targetProps("root")}
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 -ml-1.5 text-gray-400 hover:text-white cursor-pointer ${dropTarget === "root" ? "bg-purple-600/30 text-white ring-1 ring-purple-500" : ""}`}
                title="Back to all people (drop a person here to unsort)"
              >
                <ArrowLeft size={14} /> All people
              </button>
              <ChevronRight size={14} className="text-gray-600" />
              {editing?.kind === "rename" ? (
                <FolderNameForm value={editing.name} busy={busy === "folder"} onChange={(name) => setEditing({ kind: "rename", name })} onSave={() => void saveFolder()} onCancel={() => setEditing(null)} />
              ) : (
                <>
                  <span className="font-semibold text-white truncate">{folder.name}</span>
                  <span className="text-xs text-gray-500">· {here.length}</span>
                  <span className="flex-1" />
                  <Button ghost onClick={() => setEditing({ kind: "rename", name: folder.name })} disabled={busy !== null} className="!px-2 !py-1 !text-xs">
                    <Pencil size={12} /> Rename
                  </Button>
                  <Button ghost onClick={() => void deleteFolder()} busy={busy === "folder"} disabled={busy !== null || here.length > 0} title={here.length > 0 ? "Move the people out first" : "Delete this empty folder"} className="!px-2 !py-1 !text-xs">
                    <Trash2 size={12} /> Delete
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <span className="font-semibold text-white">All people</span>
              <span className="text-xs text-gray-500">· {people.length}</span>
              <span className="flex-1" />
              {editing?.kind === "new" ? (
                <FolderNameForm value={editing.name} busy={busy === "folder"} placeholder="Folder name, e.g. FOLIQ" onChange={(name) => setEditing({ kind: "new", name })} onSave={() => void saveFolder()} onCancel={() => setEditing(null)} />
              ) : (
                <Button onClick={() => setEditing({ kind: "new", name: "" })} disabled={busy !== null} className="!px-2.5 !py-1 !text-xs">
                  <FolderPlus size={13} /> New folder
                </Button>
              )}
            </>
          )}
        </div>

        <div className="relative flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto p-5">
            {error && <p className="text-xs text-red-300 mb-3">{error}</p>}
            {lib === null ? (
              <Loader2 size={20} className="mx-auto my-10 animate-spin text-gray-500" />
            ) : folder ? (
              here.length === 0 ? (
                <p className="text-sm text-gray-500 text-center my-10">
                  Nobody in {folder.name} yet. Drop photos here, or use <span className="text-gray-300">Upload photos</span>.
                </p>
              ) : (
                <div className={grid}>{here.map(renderPerson)}</div>
              )
            ) : (
              <>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Folders</p>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 mb-6">
                  {folders.map(renderFolder)}
                  <button
                    type="button"
                    onClick={() => setEditing({ kind: "new", name: "" })}
                    className="rounded-xl border border-dashed border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 flex flex-col items-center justify-center gap-1.5 text-xs cursor-pointer min-h-28"
                  >
                    <FolderPlus size={18} /> New folder
                  </button>
                </div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Unsorted · {here.length}</p>
                {here.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center my-8">
                    {people.length === 0 ? "The library is empty. Drop photos here, or use Upload photos." : "Everyone is in a folder."}
                  </p>
                ) : (
                  <div className={grid}>{here.map(renderPerson)}</div>
                )}
              </>
            )}
          </div>
          {filesOver !== null && (
            <div className="absolute inset-2 rounded-xl border-2 border-dashed border-purple-500 bg-purple-600/15 flex items-center justify-center pointer-events-none">
              <p className="text-sm font-semibold text-purple-100 bg-gray-950/80 rounded-lg px-4 py-2">
                Drop to upload {filesOver} {filesOver === 1 ? "photo" : "photos"} into {dropLabel}
              </p>
            </div>
          )}
        </div>

        <div className="relative z-10 flex items-center gap-2 p-4 border-t border-gray-800 bg-gray-950 shrink-0">
          <Button onClick={() => fileRef.current?.click()} busy={uploading !== null} disabled={busy !== null || uploading !== null}>
            <Upload size={14} /> Upload photos
          </Button>
          <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => e.target.files?.length && void uploadFiles(e.target.files, open)} />
          <span className="flex-1 text-xs text-gray-500 truncate">
            {uploading ? `Uploading ${uploading.done}/${uploading.total} into ${hereName}…` : chosen ? "1 selected" : `Click a person to select them · drop photos anywhere to upload into ${hereName}`}
          </span>
          <Button ghost onClick={onClose} disabled={busy === "pick"}>
            Cancel
          </Button>
          <Button primary onClick={confirm} busy={busy === "pick"} disabled={!chosen || busy !== null || uploading !== null}>
            <Check size={14} /> Use this person
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Inline name field for a new or renamed folder; Enter saves, Escape cancels. */
function FolderNameForm({ value, busy, placeholder, onChange, onSave, onCancel }: { value: string; busy: boolean; placeholder?: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <form
      className="flex items-center gap-2 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        maxLength={80}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
        className="flex-1 max-w-xs bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500"
      />
      <Button primary type="submit" busy={busy} disabled={!value.trim()} className="!px-2.5 !py-1 !text-xs">
        Save
      </Button>
      <Button ghost onClick={onCancel} disabled={busy} className="!px-2 !py-1 !text-xs">
        Cancel
      </Button>
    </form>
  );
}
