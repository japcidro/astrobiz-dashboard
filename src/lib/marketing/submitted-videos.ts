// Shared types for the Submitted Ad Videos review screen.
//
// Data source is the existing `ad_drafts` table (status = 'submitted').
// No new storage — the actual video lives on Facebook and is fetched
// on-demand by video_id via the Graph API. See:
//   src/app/api/marketing/submitted-videos/route.ts        (list + mark reviewed)
//   src/app/api/marketing/submitted-videos/source/route.ts (playable source URL)

export type SubmittedCreativeType = "video" | "image";

export interface SubmittedAd {
  id: string; // ad_drafts.id
  ad_name: string;
  creative_type: SubmittedCreativeType;
  video_id: string | null;
  image_hash: string | null;
  file_name: string | null;

  // Ad copy
  primary_text: string | null;
  headline: string | null;

  // Who & when
  marketer_id: string;
  marketer_name: string;
  marketer_email: string;
  submitted_at: string | null;

  // Facebook identifiers
  fb_ad_id: string | null;
  fb_campaign_id: string | null;
  fb_adset_id: string | null;
  ad_account_id: string;

  // Schedule — lets the screen show "Scheduled for X / not yet live"
  start_time: string | null;

  // Store context
  store_id: string | null;
  store_name: string | null;

  // Review marker
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
}

export interface SubmittedVideoSource {
  // Full playable URL from Facebook's CDN (temporary signed link — fetched fresh per view)
  source: string | null;
  // Thumbnail/poster image
  thumbnail: string | null;
  // Facebook permalink to the video
  permalink: string | null;
  // Video processing status: "ready" | "processing" | "error" | null
  status: string | null;
  // Length in seconds (videos only)
  length: number | null;
}
