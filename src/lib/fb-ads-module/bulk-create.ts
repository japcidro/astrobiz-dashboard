// ============================================
// Facebook Ads Module — Bulk Ad Creator
// Creates N ads sequentially: 1 campaign → N adsets → N ads
// Each row = 1 adset + 1 ad (for split-testing)
// ============================================

import { createAd } from "./create-ad";
import type {
  BulkCreateRequest,
  BulkCreateResult,
  AdInput,
  AdSetInput,
} from "./types";

/**
 * Create multiple ads in bulk under one campaign.
 * Each row creates its own adset + ad (1:1 mapping).
 *
 * - First row creates the campaign (if mode="new")
 * - Subsequent rows reuse the campaign ID
 * - Processes sequentially to avoid FB rate limits
 * - Calls onProgress after each row for UI updates
 * - Continues on error (doesn't stop the batch)
 *
 * @example
 * ```ts
 * const result = await bulkCreateAds({
 *   ad_account_id: "act_123456",
 *   token: "your_fb_token",
 *   mode: "new",
 *   existing_campaign_id: null,
 *   campaign: { name: "Split Test", objective: "OUTCOME_SALES", ... },
 *   adset_template: { daily_budget: 500, targeting: {...}, ... },
 *   page_id: "page_123",
 *   website_url: "https://mystore.com",
 *   url_parameters: "utm_source=facebook",
 *   call_to_action: "SHOP_NOW",
 *   rows: [
 *     { id: "1", adset_name: "Women 25-35", ad_name: "Video V1", video_id: "...", ... },
 *     { id: "2", adset_name: "Men 25-45", ad_name: "Image V1", image_hash: "...", ... },
 *   ],
 *   status: "ACTIVE",
 *   onProgress: (index, total, rowId, result, error) => {
 *     console.log(`${index + 1}/${total}: ${result}`);
 *   },
 * });
 * ```
 */
export async function bulkCreateAds(
  req: BulkCreateRequest
): Promise<BulkCreateResult> {
  const {
    ad_account_id,
    token,
    mode,
    existing_campaign_id,
    campaign,
    adset_template,
    page_id,
    website_url,
    url_parameters,
    call_to_action,
    rows,
    status = "ACTIVE",
    onProgress,
  } = req;

  const results: BulkCreateResult["results"] = [];
  let fbCampaignId: string | null = existing_campaign_id ?? null;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isFirstNew = i === 0 && mode === "new" && !fbCampaignId;

    // Build adset with row-specific name
    const adset: AdSetInput = {
      ...adset_template,
      name: row.adset_name || `${adset_template.name} - ${row.ad_name || `Creative ${i + 1}`}`,
    };

    // Build ad data
    const ad: AdInput = {
      name: row.ad_name || `Ad ${i + 1}`,
      page_id,
      creative_type: row.creative_type,
      image_hash: row.image_hash,
      video_id: row.video_id,
      primary_text: row.primary_text,
      headline: row.headline,
      description: row.description,
      call_to_action,
      website_url,
      url_parameters,
    };

    try {
      const result = await createAd({
        ad_account_id,
        token,
        mode: isFirstNew ? "new" : "existing_campaign",
        existing_campaign_id: isFirstNew ? null : fbCampaignId,
        existing_adset_id: null,
        campaign: isFirstNew ? campaign : null,
        adset,
        ad,
        status,
      });

      // Capture campaign ID from first successful creation
      if (!fbCampaignId && result.fb_campaign_id) {
        fbCampaignId = result.fb_campaign_id;
      }

      results.push({
        row_id: row.id,
        success: true,
        fb_campaign_id: result.fb_campaign_id,
        fb_adset_id: result.fb_adset_id,
        fb_ad_id: result.fb_ad_id,
      });
      succeeded++;
      onProgress?.(i, rows.length, row.id, "done");
    } catch (e) {
      const error = e instanceof Error ? e.message : "Unknown error";
      results.push({
        row_id: row.id,
        success: false,
        error,
      });
      failed++;
      onProgress?.(i, rows.length, row.id, "error", error);
    }
  }

  return {
    total: rows.length,
    succeeded,
    failed,
    results,
  };
}
