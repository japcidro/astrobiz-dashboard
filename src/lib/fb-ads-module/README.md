# Facebook Ads Module

Self-contained Facebook Marketing API toolkit for Next.js projects.
Copy this entire folder into your project's `src/lib/` directory.

## No Dependencies

- No Supabase, no database, no auth framework
- Just needs a **Facebook access token** and **ad account ID**
- Works with any Next.js project (App Router or Pages Router)
- Uses only native `fetch` API

## Files

| File | Purpose |
|------|---------|
| `types.ts` | All TypeScript interfaces and types |
| `fb-api.ts` | Core FB Graph API helpers (POST, GET, upload) |
| `create-ad.ts` | Create a single ad (campaign + adset + creative + ad) |
| `bulk-create.ts` | Create N ads in bulk (1 campaign, N adsets, N ads) |
| `fetch-performance.ts` | Fetch ad performance data (accounts, campaigns, ads + insights) |
| `index.ts` | Re-exports everything |

## Quick Start

### 1. Create a Single Ad

```ts
import { createAd } from "@/lib/fb-ads-module";

const result = await createAd({
  ad_account_id: "act_123456789",
  token: "your_fb_access_token",
  mode: "new",
  existing_campaign_id: null,
  existing_adset_id: null,
  campaign: {
    name: "My Campaign",
    objective: "OUTCOME_SALES",
    special_ad_categories: [],
    campaign_budget_optimization: false,
    daily_budget: null,
    lifetime_budget: null,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  },
  adset: {
    name: "My Adset",
    daily_budget: 500,
    lifetime_budget: null,
    start_time: "2026-04-11T00:00:00+08:00",
    end_time: null,
    optimization_goal: "OFFSITE_CONVERSIONS",
    billing_event: "IMPRESSIONS",
    targeting: {
      geo_locations: { countries: ["PH"] },
      age_min: 18,
      age_max: 65,
      genders: [],
    },
    promoted_object: { pixel_id: "your_pixel_id", custom_event_type: "PURCHASE" },
  },
  ad: {
    name: "My Ad",
    page_id: "your_page_id",
    creative_type: "video",
    image_hash: null,
    video_id: "your_video_id",
    primary_text: "Check out our sale!",
    headline: "50% Off Today",
    description: "Limited time only",
    call_to_action: "SHOP_NOW",
    website_url: "https://mystore.com",
    url_parameters: "utm_source=facebook&utm_medium=paid",
  },
  status: "ACTIVE",
});

console.log(result);
// { success: true, fb_campaign_id: "...", fb_adset_id: "...", fb_ad_id: "..." }
```

### 2. Bulk Create Ads

```ts
import { bulkCreateAds } from "@/lib/fb-ads-module";

const result = await bulkCreateAds({
  ad_account_id: "act_123456789",
  token: "your_fb_access_token",
  mode: "new",
  existing_campaign_id: null,
  campaign: {
    name: "Split Test Campaign",
    objective: "OUTCOME_SALES",
    special_ad_categories: [],
    campaign_budget_optimization: false,
    daily_budget: null,
    lifetime_budget: null,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  },
  adset_template: {
    name: "Template",
    daily_budget: 500,
    lifetime_budget: null,
    start_time: "2026-04-11T00:00:00+08:00",
    end_time: null,
    optimization_goal: "OFFSITE_CONVERSIONS",
    billing_event: "IMPRESSIONS",
    targeting: {
      geo_locations: { countries: ["PH"] },
      age_min: 25,
      age_max: 45,
      genders: [2],
    },
    promoted_object: { pixel_id: "your_pixel_id", custom_event_type: "PURCHASE" },
  },
  page_id: "your_page_id",
  website_url: "https://mystore.com",
  url_parameters: "utm_source=facebook&utm_medium=paid",
  call_to_action: "SHOP_NOW",
  rows: [
    { id: "1", adset_name: "Women 25-35 V1", ad_name: "Video V1", creative_type: "video", video_id: "vid_1", image_hash: null, file_name: "vid1.mp4", primary_text: "Shop now!", headline: "Big Sale", description: "50% off" },
    { id: "2", adset_name: "Women 25-35 V2", ad_name: "Video V2", creative_type: "video", video_id: "vid_2", image_hash: null, file_name: "vid2.mp4", primary_text: "Shop now!", headline: "Big Sale", description: "50% off" },
  ],
  status: "ACTIVE",
  onProgress: (index, total, rowId, result, error) => {
    console.log(`[${index + 1}/${total}] Row ${rowId}: ${result}${error ? ` - ${error}` : ""}`);
  },
});

console.log(`${result.succeeded}/${result.total} ads created`);
```

### 3. Upload Creatives (Client-Side)

```ts
import { uploadFileClient } from "@/lib/fb-ads-module";

// Auto-detects image vs video from file MIME type
const result = await uploadFileClient(file, "act_123456789", "your_token");
// result = { image_hash: "abc123" } for images
// result = { video_id: "456789" } for videos
```

### 4. Fetch Ad Performance

```ts
import { fetchAdPerformance } from "@/lib/fb-ads-module";

const result = await fetchAdPerformance({
  token: "your_fb_access_token",
  datePreset: "last_7d",
  accountFilter: "ALL", // or specific account ID
  selectedAccountIds: [], // optional pre-filter
});

console.log(result.totals);
// { count, spend, link_clicks, purchases, add_to_cart, reach, impressions, cpa, roas, ctr }

console.log(result.data);
// AdRow[] — each ad with: account, campaign, adset, ad, status, spend, roas, cpa, etc.

console.log(result.accounts);
// AccountInfo[] — id, name, status, is_active

console.log(result.budgets);
// { [entityId]: { daily_budget, lifetime_budget } }
```

## How to Get a Token

You need a Facebook System User token or User token with `ads_management` permission.
The token is passed directly to all functions — store it however you want (env vars, database, etc.)

## Facebook API Version

Currently uses **v21.0**. To change, update `FB_API_VERSION` in `fb-api.ts`.
