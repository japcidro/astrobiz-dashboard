export type ReferenceSource = "paste" | "board" | "winner";

/** One beat of the reference, as Claude read it. */
export interface StudyBeat {
  role: string;
  range: string;
  summary: string;
}

/** What won in the reference script. */
export interface Study {
  angle: string;
  hook_move: string;
  language: string;
  tone: string;
  structure: StudyBeat[];
  why_it_works: string;
  theirs_to_replace: string[];
}

/** Their line → our line, every beat. */
export interface PlanBeat {
  role: string;
  theirs: string;
  ours: string;
}

export interface Plan {
  beats: PlanBeat[];
  kept: string[];
  added_from_dna: string[];
  target_seconds: number;
}

export interface ScriptBeat {
  t: string;
  line: string;
  on_screen: string;
  visual: string;
}

export interface ReviewScores {
  hook: number;
  structure: number;
  language: number;
  compliance: number;
  brand: number;
}

export interface Review {
  ok: boolean;
  fixable: boolean;
  scores: ReviewScores;
  notes: string;
  /** Set while the reviewer is working; cleared when it lands. */
  checking?: boolean;
}

export type ScriptStatus = "writing" | "done" | "failed";

export interface ScriptRow {
  id: string;
  run_id: string;
  idx: number;
  status: ScriptStatus;
  title: string;
  hook: string;
  beats: ScriptBeat[];
  cta: string;
  seconds: number | null;
  script_text: string;
  review: Review | null;
  attempts: number;
  kept: boolean;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunRow {
  id: string;
  item_id: string | null;
  store: string;
  reference_text: string;
  reference_label: string;
  reference_source: ReferenceSource;
  notes: string;
  versions: number;
  study: Study | null;
  plan: Plan | null;
  dna_built_at: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RunView extends RunRow {
  scripts: ScriptRow[];
}

/** One of our ads that sold, from the cached ad metrics; its transcript (when deconstructed) can be the next reference. */
export interface Winner {
  ad_id: string;
  account_id: string | null;
  ad: string;
  created_time: string | null;
  purchases: number;
  spend: number;
  cpa: number | null;
  verdict: "winner" | "middle" | "loser";
  thumbnail_url: string | null;
  /** The spoken words with timestamps and [ON-SCREEN] markers, or "" until the ad is deconstructed. */
  transcript: string;
  hook: string;
  seconds: number | null;
}

export interface WinnersView {
  store: string;
  winners: Winner[];
  refreshed_at: string;
}

export interface DnaView {
  store: string;
  dna: string;
  built_at: string;
  /** How many ads the brief was written from (0 for the hand-written seed). */
  ads_read: number;
  /** How many of those launched inside the anchor window. */
  winning_now: number;
  anchor_days: number;
  /** The marketer's standing brief for the brand, read before every run. */
  brief: string;
}

export interface BoardVideo {
  id: string;
  title: string;
  author: string | null;
  seconds: number | null;
  thumb_url: string | null;
}

export interface StudioPage {
  item: { id: string; title: string | null; store: string | null; has_video: boolean } | null;
  stores: string[];
  /** Stores with a brand profile in the Clipper's brand kit. */
  profiled: string[];
  dna: Record<string, DnaView>;
  winners: Record<string, WinnersView>;
  board_videos: BoardVideo[];
  runs: RunView[];
}

export const MAX_VERSIONS = 4;
export const DEFAULT_VERSIONS = 2;
export const DEFAULT_ANCHOR_DAYS = 45;
/** Ads launched inside the window count as "winning now". */
export const isRecent = (createdTime: string | null, anchorDays: number) => !!createdTime && Date.now() - new Date(createdTime).getTime() <= anchorDays * 86_400_000;
