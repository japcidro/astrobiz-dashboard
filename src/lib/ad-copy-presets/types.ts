export type AdCopyPresetKind =
  | "ad_name"
  | "primary_text"
  | "headline"
  | "description";

export const AD_COPY_PRESET_KINDS: AdCopyPresetKind[] = [
  "ad_name",
  "primary_text",
  "headline",
  "description",
];

export const AD_COPY_PRESET_KIND_LABELS: Record<AdCopyPresetKind, string> = {
  ad_name: "Ad Name",
  primary_text: "Primary Text",
  headline: "Headline",
  description: "Description",
};

export interface AdCopyPreset {
  id: string;
  shopify_store_id: string;
  kind: AdCopyPresetKind;
  label: string;
  content: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAdCopyPresetInput {
  shopify_store_id: string;
  kind: AdCopyPresetKind;
  label: string;
  content: string;
}

export interface UpdateAdCopyPresetInput {
  label?: string;
  content?: string;
}
