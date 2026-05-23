export type BrandFileCategory =
  | "winning_scripts"
  | "brand_voice"
  | "product_info"
  | "customer_reviews"
  | "other";

export const BRAND_FILE_CATEGORIES: readonly BrandFileCategory[] = [
  "winning_scripts",
  "brand_voice",
  "product_info",
  "customer_reviews",
  "other",
] as const;

export const BRAND_FILE_CATEGORY_LABELS: Record<BrandFileCategory, string> = {
  winning_scripts: "Winning Scripts",
  brand_voice: "Brand Voice",
  product_info: "Product Info",
  customer_reviews: "Customer Reviews",
  other: "Other",
};

export interface BrandReferenceFile {
  id: string;
  store_name: string;
  title: string;
  category: BrandFileCategory;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  extracted_text: string;
  file_size_bytes: number | null;
  created_by: string | null;
  created_at: string;
}

export interface BrandSystemPrompt {
  id: string;
  store_name: string;
  system_prompt: string;
  updated_at: string;
  updated_by: string | null;
}
