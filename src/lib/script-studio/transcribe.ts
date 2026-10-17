import type { SupabaseClient } from "@supabase/supabase-js";
import { deconstructAdVideo } from "@/lib/gemini/deconstruct";
import { signBoardPaths } from "@/lib/marketing-board/storage";

/**
 * The script of a Marketing Board video, read by the same Gemini
 * deconstructor the nightly cron uses, from the Mac's saved copy. Returns
 * the transcript with its timestamps and [ON-SCREEN: …] markers, which the
 * adapter reads as pacing and captions.
 */
const UPLOAD_PATH = /^script-studio\/uploads\/[\w-]+\.(mp4|mov|webm)$/;

/** The script of a video the marketer uploaded straight to the generator. */
export async function transcribeUpload(db: SupabaseClient, path: string, label: string): Promise<{ text: string; label: string; seconds: number | null } | { error: string }> {
  if (!UPLOAD_PATH.test(path)) return { error: "Bad upload path" };
  const { data: keyRow } = await db.from("app_settings").select("value").eq("key", "gemini_api_key").maybeSingle();
  const key = (keyRow?.value as string | undefined) ?? null;
  if (!key) return { error: "No Gemini API key in Settings" };
  const signed = await signBoardPaths(db, [path]);
  const url = signed.get(path);
  if (!url) return { error: "Could not open the uploaded video" };
  try {
    const out = await deconstructAdVideo(url, key);
    const text = (out.analysis.transcript ?? "").trim();
    if (!text) return { error: "Gemini heard no speech in this video" };
    const seconds = typeof out.analysis.duration_seconds === "number" ? Math.round(out.analysis.duration_seconds) : null;
    return { text, label: (label.trim() || "Uploaded video").slice(0, 120), seconds };
  } catch (e) {
    return { error: e instanceof Error ? `Transcription failed: ${e.message.slice(0, 200)}` : "Transcription failed" };
  }
}

export async function transcribeBoardItem(db: SupabaseClient, itemId: string): Promise<{ text: string; label: string; seconds: number | null } | { error: string }> {
  const { data: item } = await db.from("marketing_board_items").select("id, title, author, video_path, duration").eq("id", itemId).maybeSingle();
  if (!item) return { error: "Board card not found" };
  const path = item.video_path as string | null;
  if (!path) return { error: "This card has no saved copy yet; the Mac saves one a minute or two after the link is added" };
  const { data: keyRow } = await db.from("app_settings").select("value").eq("key", "gemini_api_key").maybeSingle();
  const key = (keyRow?.value as string | undefined) ?? null;
  if (!key) return { error: "No Gemini API key in Settings" };
  const signed = await signBoardPaths(db, [path]);
  const url = signed.get(path);
  if (!url) return { error: "Could not open the saved copy" };
  try {
    const out = await deconstructAdVideo(url, key);
    const text = (out.analysis.transcript ?? "").trim();
    if (!text) return { error: "Gemini heard no speech in this video" };
    const label = [(item.author as string | null) ?? "", (item.title as string | null) ?? ""].filter(Boolean).join(" · ") || "Board video";
    return { text, label: label.slice(0, 120), seconds: typeof item.duration === "number" ? Math.round(item.duration) : null };
  } catch (e) {
    return { error: e instanceof Error ? `Transcription failed: ${e.message.slice(0, 200)}` : "Transcription failed" };
  }
}
