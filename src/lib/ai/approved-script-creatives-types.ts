export type ApprovedScriptCreativeType = "image" | "video";

export interface ApprovedScriptCreative {
  id: string;
  approved_script_id: string;
  fb_ad_account_id: string;
  creative_type: ApprovedScriptCreativeType;
  fb_image_hash: string | null;
  fb_video_id: string | null;
  file_name: string | null;
  thumbnail_url: string | null;
  label: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface CreateApprovedScriptCreativeInput {
  fb_ad_account_id: string;
  creative_type: ApprovedScriptCreativeType;
  fb_image_hash?: string | null;
  fb_video_id?: string | null;
  file_name?: string | null;
  thumbnail_url?: string | null;
  label?: string | null;
}

export interface UpdateApprovedScriptCreativeInput {
  label?: string | null;
  thumbnail_url?: string | null;
}
