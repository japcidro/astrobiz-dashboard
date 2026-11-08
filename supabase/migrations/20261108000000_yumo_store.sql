-- YUMO: register the new bag store everywhere the dashboard keys on a store.
--
-- Shopify store xtcz8c-1i.myshopify.com (www.wearyumo.shop), one product,
-- "The Lettered Tote" (Black LT-BLK, Cream LT-CRM). Meta: the Page "YUMO"
-- (477507618772973) and the pixel the store's Facebook & Instagram app fires
-- ("YUMO-SHOPIFY", 325004377113740, HIBI's old pixel renamed, shared with
-- every ad account). No ad account is named for YUMO yet, so ad_account_id
-- stays empty and spend attributes by campaign name ("YUMO-…") until one is
-- set. The store row carries no Admin API token until its Shopify app is
-- connected over OAuth from /admin/settings. Also fills HALORINNA's Page,
-- which exists now ("Halorinna", 101668252725559). Idempotent.

insert into public.shopify_stores (name, store_url, is_active)
select 'YUMO', 'xtcz8c-1i.myshopify.com', true
where not exists (select 1 from public.shopify_stores where upper(name) = 'YUMO');

insert into public.store_ad_defaults (
  shopify_store_id, page_id, page_name, pixel_id, website_url, url_parameters,
  default_cta, default_daily_budget, default_countries, default_age_min,
  default_age_max, suggest_copy_enabled, suggest_copy_language, suggest_copy_use_winners
)
select
  s.id, '477507618772973', 'YUMO', '325004377113740', 'https://www.wearyumo.shop/',
  'utm_source=facebook&utm_medium=paid', 'SHOP_NOW', 500, '{PH}', 18, 65,
  true, 'english', true
from public.shopify_stores s
where upper(s.name) = 'YUMO'
  and not exists (select 1 from public.store_ad_defaults d where d.shopify_store_id = s.id);

update public.store_ad_defaults d
   set page_id = '101668252725559', page_name = 'Halorinna', updated_at = now()
  from public.shopify_stores s
 where s.id = d.shopify_store_id and upper(s.name) = 'HALORINNA' and d.page_id is null;

-- COGS: the brand plan's assumed landed cost, ₱250 a bag, until the real
-- invoice replaces it in /admin/cogs.
insert into public.cogs_items (store_name, sku, product_name, cogs_per_unit, vat_rate)
values
  ('YUMO', 'LT-BLK', 'The Lettered Tote · Black', 250.00, 0),
  ('YUMO', 'LT-CRM', 'The Lettered Tote · Cream', 250.00, 0)
on conflict (store_name, sku) do nothing;

insert into public.remake_brand_kits (store, rules, profile)
values (
  'YUMO',
  $rules$The bag is reproduced exactly from its photos: soft mid-weight cotton canvas that slouches when not full, wider than tall (about 38 × 30 × 11 cm), a zip top with a small black pull, cream cotton-webbing straps printed with black lettering and a small diamond separator that continue down the front as two vertical edge-stitched bands, a two-line flocked serif print on the body between them, black-and-white pinstripe lining with one inside zip pocket, no outer pockets, no feet, no other hardware. Two colourways only, Black and Cream; show both when the ad is about The Pair. The lettering on the bag is never retyped as a word and never named; the only brand mark on an ad is the YUMO. wordmark (Instrument Serif, ink #17160F or white, moss #4B5443 full stop). Real Filipina models in natural light, Manila streets, cafés and desks; premium and understated, never a bargain or budget framing.$rules$,
  $profile$Brand: YUMO (wearyumo.shop). Product: The Lettered Tote, a soft cotton-canvas tote with a zip top, lettered cream webbing straps that run down the front as two stitched bands, a black-and-white pinstripe lining with one inside zip pocket, in Black or Cream. Approx. 38 × 30 × 11 cm, strap drop approx. 25 cm, about 450 g; fits a 13 to 14-inch laptop (a 15.6-inch does not). Designed in Manila. "Everyday bags, beautifully made." "Carry it well."

Audience: Filipino women roughly 25–45 with money to spend and English as their everyday language: office and work-from-home professionals, moms on the go, who want one good-looking everyday bag that zips shut and goes with every outfit. Upscale positioning: never compare YUMO to cheap or budget totes, never quote a competitor's price, avoid "looks expensive" (it implies the bag is not).

Price: 1 tote ₱1,190 (no compare-at). The Pair (one Black + one Cream) ₱1,890 instead of ₱2,380, flagged "Most popular"; 2 of the same colour ₱1,890 instead of ₱2,380 (save ₱490). Christmas pricing until 18 December 2026. Free shipping on every order, cash on delivery nationwide (no online payment for now), 7-day easy returns, ships within 24 hours from Metro Manila. Prices change: read the live store before quoting one.
Discount anchor (the "was" price every ad shows, against the entry price): The Pair was ₱2,380 → now ₱1,890 (save ₱490, 20% off).

Social proof: none yet. The site's rating lines, reviews and press mentions stay hidden until they are real; never invent ratings, review counts or "as seen in".

Core angle: "Everyone loves a tote. We wanted one that closes." The zip top and the inside zip pocket are the difference: zipped, on the shoulder, hands free; open at the desk, everything where you left it; emptied out, it folds soft. One bag, Monday to Sunday, work to weekend, in Black and Cream. The Pair as a gift ("The Pair, wrapped"). Ad angles in use: everything fits (kasya lahat), it zips (may zipper), the corporate girlie bag, arrives tomorrow (bukas dating).

Proof points: zip top with a small pull; lettered webbing stitched the full height of the bag; soft mid-weight cotton canvas that folds flat when empty (never "heavyweight", never "stands on its own"); pinstripe lining with a zip pocket; room for a 13–14-inch laptop, a water bottle and the everyday kit; no outer pockets, no hardware beyond the zips; ships within 24 hours.

Benefit lines that work: Beautifully made. Zips shut. Arrives tomorrow. · Zipped, on the shoulder, hands free. · Everything, actually. · On the way to work, in Black and Cream. · Monday to Sunday. · Carry it well.

Tone: English, quiet, confident, premium and understated, like a label introducing itself rather than a seller; talking heads speak natural Filipino-accented English; Taglish only when an ad is deliberately casual. Organic Page posts carry no prices or offer; ads may sell, with every price taken from the live store.

Visual identity: the wordmark is "YUMO." in Instrument Serif with a moss full stop, ink on paper or white on dark photos; the monogram is "Y." Type: Instrument Serif for headlines, Hanken Grotesk for text. Palette: ink #17160F, paper #FAF8F4, bone #EDE7DB, stone #7D7769, moss #4B5443 (accents and the full stop only). Editorial fashion photography in natural daylight: the bag on a real Filipina model's shoulder on a Manila street, at a café or a desk, or on a clean studio surface, both colourways together where possible. Never candy colours, never a discount-sticker look.

Compliance: the lettering printed on the straps and body is a third-party wordmark; never type it, name it or spell it in copy, headlines or alt text; the product is "The Lettered Tote". No "heavyweight canvas", no "stands on its own", no laptop size above 14 inches, no ratings, review counts or press mentions until real. Measurements are approximate until tape-measured.$profile$
)
on conflict (store) do nothing;
