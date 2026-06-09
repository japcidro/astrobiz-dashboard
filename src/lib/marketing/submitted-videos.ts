// Shared types for the Submitted Ad Videos review screen.
//
// Source of truth is the Facebook ad account itself — we list ads directly
// from Facebook so EVERY submitted ad shows up (including scheduled ones and
// ads not tracked in ad_drafts). The video file lives on Facebook; the grid
// uses the creative's inline thumbnail, and playback resolves a fresh CDN
// URL by video_id on demand. See:
//   src/app/api/marketing/submitted-videos/route.ts        (list from FB + mark reviewed)
//   src/app/api/marketing/submitted-videos/source/route.ts (playable source URL)

export type SubmittedCreativeType = "video" | "image";

export interface SubmittedAd {
  // Facebook identifiers
  fb_ad_id: string;
  ad_account_id: string;
  ad_name: string;

  creative_type: SubmittedCreativeType;
  video_id: string | null;
  thumbnail_url: string | null; // inline from FB creative — no extra call
  image_url: string | null; // for image ads — playable/displayable directly

  // Attribution (inferred from the ad name prefix: LIN→Linette, JO→Jhoanna)
  marketer_name: string;
  marketer_code: string | null;

  // When it was created on Facebook
  created_time: string | null;

  // Schedule / delivery
  start_time: string | null; // adset start_time
  effective_status: string | null; // FB effective_status (ACTIVE, PENDING_REVIEW, …)
  is_scheduled: boolean; // start_time in the future

  // Context
  store_name: string | null; // matched from campaign/ad name
  campaign_name: string | null;
  adset_name: string | null;

  // Review marker (from fb_ad_reviews, keyed by fb_ad_id)
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;

  // Note / comment (from fb_ad_notes, keyed by fb_ad_id)
  note: string | null;
  note_by_name: string | null;
  note_at: string | null;

  // Starred / tagged as a good creative (from fb_ad_stars, keyed by fb_ad_id)
  is_starred: boolean;
}

export interface SubmittedVideoSource {
  source: string | null; // playable MP4 (video) — fetched fresh per view
  thumbnail: string | null;
  permalink: string | null;
  status: string | null; // "ready" | "processing" | …
  length: number | null;
}
