import type { BrandCheck } from "@/lib/remake/types";

export type AttachmentRole = "reference" | "model" | "product" | "look";
export const ROLE_LABEL: Record<AttachmentRole, string> = { reference: "Reference · copy the layout", model: "Model · this face", product: "Product · exact label", look: "Look · style only" };

/** Brand photos of what is inside the pack; the pack itself is any other kind (bottle, box, jar, …). */
const CONTENT_KINDS = new Set(["capsules", "gummies"]);
export const isContents = (kind: string | null | undefined) => CONTENT_KINDS.has(kind ?? "");

/**
 * The brand photos an adapt run attaches, in brand kit order: up to two of the
 * pack (what gets reproduced) and one of the contents, for scenes that show
 * them loose. The Brand Kit page marks the same photos.
 */
export function pickStaticAdPhotos<T extends { kind: string | null }>(images: T[]): { packs: T[]; contents: T[] } {
  let packs = images.filter((p) => !isContents(p.kind)).slice(0, 2);
  if (packs.length === 0) packs = images.slice(0, 1);
  const contents = images.filter((p) => isContents(p.kind) && !packs.includes(p)).slice(0, 1);
  return { packs, contents };
}

export interface Attachment {
  bucket: string;
  path: string;
  role: AttachmentRole;
  label: string;
  /** For a product: the brand image's kind. Capsules or gummies are what is inside, not the pack. */
  kind?: string | null;
}

export interface AttachmentView extends Attachment {
  url: string | null;
}

export type ProductMode = "in" | "none";
export type PersonMode = "model" | "none" | "new";
export type OutputMode = "single" | "pair" | "set3";
export type ImageFormat = "1:1" | "4:5" | "9:16" | "1.91:1";
export type TextStyle = "reference" | "clean";
export type PresetId = "adapt" | "before_after" | "product_only" | "model_only" | "testimonial" | "blank";

export interface RunInput {
  item_id: string | null;
  store: string | null;
  preset: PresetId;
  instruction: string;
  product_mode: ProductMode;
  person_mode: PersonMode;
  output: OutputMode;
  format: ImageFormat;
  versions: number;
  text_on_image: string;
  text_style: TextStyle;
  attachments: Attachment[];
}

/** What the adapt skill decided before generating. */
export interface AdaptPlan {
  study: { angle: string; structure: string; style: string; why_it_works: string };
  plan: { text: Array<{ from: string; to: string }>; final_text: string; needs_person: boolean; /** Which of the brand's models the planner picked, 1-based; 0 = it cast the person itself (older plans: unset). */ model_pick?: number; needs_product: boolean; design_spec: string; /** Loose capsules or gummies outside the pack in the design. */ shows_contents?: boolean };
  model_label?: string | null;
  /** The exact look of our pack (colours, every label line), from the brand photo; locks the product in the prompt and the review. */
  product_lock?: string | null;
}

export interface ReviewScores {
  design: number;
  brand: number;
  structure: number;
}

export interface RunRow extends RunInput {
  id: string;
  prompt: string;
  plan: AdaptPlan | null;
  created_by: string | null;
  created_at: string;
}

export type ResultStatus = "queued" | "running" | "done" | "failed";

export interface ResultRow {
  id: string;
  run_id: string;
  idx: number;
  status: ResultStatus;
  job_id: string | null;
  path: string | null;
  preview_path: string | null;
  pair_paths: string[] | null;
  /** product_ok: the strict pack check (false = the bottle came out wrong; null = nothing to compare). */
  brand_check: (BrandCheck & { scores?: ReviewScores; product_ok?: boolean | null }) | null;
  attempts: number;
  kept: boolean;
  credits: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResultView extends ResultRow {
  url: string | null;
  preview_url: string | null;
  pair_urls: string[] | null;
}

export interface RunView extends RunRow {
  attachments: AttachmentView[];
  results: ResultView[];
}

/** Images the studio can attach, grouped by where they come from. */
export interface StudioSources {
  people: Array<{ id: string; folder: string | null; name: string; bucket: string; path: string; url: string }>;
  stills: Array<{ id: string; title: string; bucket: string; path: string; url: string }>;
  brand: Array<{ store: string; kind: string | null; bucket: string; path: string; url: string }>;
  board: Array<{ id: string; title: string; bucket: string; path: string; url: string }>;
}

export interface StudioPage {
  item: { id: string; title: string | null; store: string | null; bucket: string; path: string | null; url: string | null } | null;
  stores: string[];
  /** Stores with a brand profile in the Brand Kit. */
  profiled: string[];
  sources: StudioSources;
  runs: RunView[];
}

export const PRESETS: Array<{ id: PresetId; label: string; instruction: string; product: ProductMode; person: PersonMode; output: OutputMode }> = [
  { id: "adapt", label: "Adapt this ad for our brand", instruction: "Same layout, composition and vibe as the reference, but it is our brand: our person holds our product the way the original does. Keep the text placement; the headline is our text.", product: "in", person: "model", output: "single" },
  { id: "before_after", label: "Before & after scalp", instruction: "Close-up of a man's crown and hairline, overhead bathroom light, phone-camera realism. BEFORE: visibly thinning crown, scalp showing through. AFTER (90 days later): noticeably fuller, denser hair on the same head, same angle and lighting. No product, no face, no text.", product: "none", person: "none", output: "pair" },
  { id: "product_only", label: "Product shot, no person", instruction: "Our bottle on a clean bathroom counter next to a towel, soft morning window light, shallow depth of field, premium but real. Label straight to camera and fully readable.", product: "in", person: "none", output: "single" },
  { id: "model_only", label: "Model only", instruction: "Our person, candid phone selfie in a bright room, relaxed smile, looking at the camera, no product, no text.", product: "none", person: "model", output: "single" },
  { id: "testimonial", label: "Testimonial post", instruction: "A social post that looks like a customer's own photo: our person at home holding our bottle up to the camera, honest and unpolished, with a short Taglish quote as the headline.", product: "in", person: "model", output: "single" },
  { id: "blank", label: "Blank", instruction: "", product: "in", person: "model", output: "single" },
];
