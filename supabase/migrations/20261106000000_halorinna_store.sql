-- HALORINNA: register the new store everywhere the dashboard keys on a store.
--
-- Shopify store qivryv-zj.myshopify.com (tryhalorinna.shop), Meta ad account
-- "TBM1 - HALORINNA" (act_413806304492069, Tony BM) and the pixel the
-- store's Facebook & Instagram app installs ("HALORINNA - SHOPIFY PIXEL",
-- 413803164871787, read from the storefront's web-pixel config). No Facebook
-- Page exists yet, so page_id/page_name stay empty until it is made.
--
-- The store row carries no Admin API token: the Shopify app for it has to be
-- created in the Dev Dashboard and connected over OAuth from /admin/settings.
-- Until then every multi-store fetcher skips it (api_token is null) while the
-- store pickers already list it. Idempotent.

-- 1. The store itself.
insert into public.shopify_stores (name, store_url, is_active)
select 'HALORINNA', 'qivryv-zj.myshopify.com', true
where not exists (
  select 1 from public.shopify_stores where upper(name) = 'HALORINNA'
);

-- 2. Ad defaults for the Create / Bulk Create wizards.
insert into public.store_ad_defaults (
  shopify_store_id, ad_account_id, pixel_id, website_url, url_parameters,
  default_cta, default_daily_budget, default_countries, default_age_min,
  default_age_max, suggest_copy_enabled, suggest_copy_language,
  suggest_copy_use_winners
)
select
  s.id, 'act_413806304492069', '413803164871787', 'https://tryhalorinna.shop/',
  'utm_source=facebook&utm_medium=paid', 'SHOP_NOW', 500, '{PH}', 18, 65,
  true, 'english', true
from public.shopify_stores s
where upper(s.name) = 'HALORINNA'
  and not exists (
    select 1 from public.store_ad_defaults d where d.shopify_store_id = s.id
  );

-- 3. The ad account joins the selected accounts every ads screen and the P&L
--    read (app_settings.fb_selected_accounts is a JSON array of act_ ids).
update public.app_settings
   set value = (value::jsonb || '["act_413806304492069"]'::jsonb)::text,
       updated_at = now()
 where key = 'fb_selected_accounts'
   and not (value::jsonb ? 'act_413806304492069');

-- 4. COGS. The product is sold as 1/2/3/5-box bundles, one variant each, at
--    ₱150 a box landed (imported, no VAT invoice). The variants carry no SKU
--    yet; these are the codes to set on them in Shopify so the P&L can match
--    line items. Editable in /admin/cogs.
insert into public.cogs_items (store_name, sku, product_name, cogs_per_unit, vat_rate)
values
  ('HALORINNA', 'GBA-1', 'Glow Boosting Ampoule · 1 box (20 ampoules)', 150.00, 0),
  ('HALORINNA', 'GBA-2', 'Glow Boosting Ampoule · 2 boxes', 300.00, 0),
  ('HALORINNA', 'GBA-3', 'Glow Boosting Ampoule · 3 boxes', 450.00, 0),
  ('HALORINNA', 'GBA-5', 'Glow Boosting Ampoule · 5 boxes', 750.00, 0)
on conflict (store_name, sku) do nothing;

-- 5. Brand kit profile and rules for the Static Ad Generator, Script
--    Generator and Clipper. Product photos are uploaded in /owner/brand-kit.
insert into public.remake_brand_kits (store, rules, profile)
values (
  'HALORINNA',
  $rules$The ampoule is a small single-use pink plastic ampoule, 1.5 ml, about 2.5 inches long with a snap-off top — never a dropper bottle, glass vial, pipette or tube. The box is white with magenta HALORINNA lettering and holds 20 ampoules in a tray. Show the ampoule at true size: it fits across two fingers.$rules$,
  $profile$Brand: HALORINNA (tryhalorinna.shop). Product: HALORINNA Glow Boosting Ampoule, a needle-free "spicule" glow serum in single-use ampoules. One box of 20 pink ampoules, 1.5 ml each, one ampoule a night; three boxes (60 nights, about two months) is the full course.

Audience: Filipino women roughly 35–55, moms and working women who see dull, rough, tired-looking skin, fine lines and dark spots, have tried creams and serums that did nothing visible, and will not go to a clinic for microneedling. Price-aware but willing to pay for something that shows.

Price: 1 box ₱990; 2 boxes ₱1,490 (was ₱1,980); 3 boxes ₱1,990 (was ₱2,970, most popular, pre-selected on the page); 5 boxes ₱2,790 (was ₱4,950, best value). Free shipping from 2 boxes. Cash on delivery nationwide. 30-day glow guarantee.

Social proof: use the rating and review count shown on the live page; never invent numbers.

Core angle: needle-free microneedling at home. Hydrolyzed sponge spicules (microscopic natural needles from freshwater sponge) open micro-channels in the skin so the actives go deeper than a cream can, then sodium hyaluronate, shea, tremella, yeast beta-glucan and schizophyllan hydrate, calm and repair. "The glow a cream can't reach." Clinic-style results at home: no needles, no clinic, no downtime.

Proof points: spicule mechanism (needle-free microneedling); single-use ampoules keep each dose fresh and measured; hyaluronate for plumping hydration, shea for the barrier, tremella and beta-glucan for calming and repair; one ampoule a night, pat in, done. A tingling warmth on application is the spicules working.

Results claims: two months, 60 nights, three boxes — never faster. Glow and smoother texture first, tone and fine lines over the full course.

Benefit lines that work: Needle-free microneedling at home · The glow a cream can't reach · One ampoule a night · Smoother texture, brighter tone, fewer fine lines · Fresh single-use dose every time · No clinic, no needles, no downtime.

Tone: warm, confident, science-led, woman-to-woman; full English (Taglish only inside reviews and testimonials). Explain the mechanism simply, like femplus.com's selling science. Never medical promises.

Visual identity: pink single-use ampoules with a snap-off top in a white box with magenta HALORINNA lettering. Palette: magenta #d8175c, deep raspberry #93103f, soft pink, white. Clean bright light, bathroom counter and vanity settings, real Filipino women 35+ with believable skin. Headlines in a clean geometric sans (Onest).

Compliance: a cosmetic, not a drug — no "cure", "treat", "clinically proven" or dermatologist claims; "needle-free" is the only needle reference. The brand is a Chinese OEM product: never claim Korean origin. Before/after images are generated — keep them plausible, no dramatic transformations. The guarantee is the 30-day glow guarantee as worded on the page, nothing more.$profile$
)
on conflict (store) do nothing;
