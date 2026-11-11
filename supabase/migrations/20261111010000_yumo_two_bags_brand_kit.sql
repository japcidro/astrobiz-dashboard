-- YUMO brand kit: two bags, and Khaki instead of Cream.
--
-- The kit written on 2026-11-08 knew one product, The Lettered Tote in Black
-- and Cream. Since then Cream sold out and Khaki replaced it (2026-11-09),
-- and YUMO's own bag, The YUMO Tote, went live on its own page (2026-11-10).
-- The profile and rules now cover both products, every photo is filed under
-- its product so the Static Ad Generator can ask which one an ad sells, the
-- Cream photos are kept but never used in static ads, and the photo
-- descriptions no longer spell the third-party lettering. Idempotent; the
-- photo updates match on the upload's file name.

update public.remake_brand_kits
   set rules = $rules$YUMO sells two bags; an ad shows one of them, never a mix, and each is reproduced exactly from its photos. Both are soft mid-weight cotton canvas totes that slouch when not full, wider than tall (about 38 × 30 × 11 cm), with a zip top and cream cotton-webbing straps printed with black lettering that continue down the front as two vertical stitched bands to the bottom edge; no outer pockets, no feet. THE LETTERED TOTE: Black or Khaki (sand body, lighter cream straps; there is no Cream bag any more), a two-line serif print on the body, black-and-white pinstripe lining; show Black and Khaki together when the ad is about The Pair. Its lettering is a third-party wordmark: reproduce it on the bag as in the photo, but never type it or name it in any headline, caption or text on the ad. THE YUMO TOTE: Black only, the word YUMO in large white serif capitals on the front, straps printed with YUMO and a small diamond between repeats on every visible part, cream zip tape with silver pulls, an inside zip pocket and an antique-brass key hook on a canvas tab inside. The brand mark on an ad is the YUMO. wordmark in a refined high-contrast serif, ink #17160F or white, with a moss #4B5443 full stop. Real Filipina models in natural light, Manila streets, cafés and desks; premium and understated, never a bargain or budget framing.$rules$,
       profile = $profile$Brand: YUMO (wearyumo.shop), a Manila bag label. "Everyday bags, beautifully made." "Carry it well." YUMO sells two totes; an ad sells one of them.

PRODUCT 1 — The Lettered Tote (ad link https://www.wearyumo.shop/): a soft cotton-canvas tote with a zip top, lettered cream webbing straps that run down the front as two stitched bands, a two-line serif print on the body, a black-and-white pinstripe lining with one inside zip pocket. Colours: Black and Khaki (sand body, lighter cream straps). Cream is no longer sold; never show or mention it. Price: 1 tote ₱1,190. The Pair (one Black + one Khaki) ₱1,890 instead of ₱2,380, flagged "Most popular"; 2 of the same colour ₱1,890 instead of ₱2,380 (save ₱490).
Discount anchor (the "was" price every ad shows, against the entry price): The Pair was ₱2,380 → now ₱1,890 (save ₱490, 20% off).
Core angle: "Everyone loves a tote. We wanted one that closes." One bag, Monday to Sunday, work to weekend, in Black and Khaki. The Pair as a gift ("The Pair, wrapped").

PRODUCT 2 — The YUMO Tote (ad link https://www.wearyumo.shop/products/the-yumo-tote): YUMO's own bag. Black canvas with YUMO in large white serif capitals on the front, cream webbing straps printed with YUMO and a small diamond, running down the front to the bottom edge; full-width zip top with cream tape and silver pulls; an inside zip pocket; a key hook (antique-brass swivel clip on a canvas tab) sewn inside near the top. One colour: Black. Price: 1 tote ₱1,190. "Keep one, gift one": 2 totes ₱1,890 instead of ₱2,380 (save ₱490).
Discount anchor: Keep one, gift one was ₱2,380 → now ₱1,890 (save ₱490, 20% off).
Core angle: the three things inside that an open tote does not have: the zip top, the inside zip pocket, the key hook ("your keys, clipped where you can find them"). Keep one, gift one: one for you, one for your sister, your best friend or your Secret Santa; a gift that gets used every day.

Both bags: approx. 38 × 30 × 11 cm, strap drop approx. 25 cm, about 450 g; fits a 13 to 14-inch laptop (a 15.6-inch does not), a water bottle and the everyday kit. Designed in Manila.

Offer terms, both: the 2-tote price runs until 18 December 2026 ("Order by 18 December for Christmas"). Free shipping on every order, cash on delivery nationwide (no online payment for now), 7-day easy returns, ships within 24 hours from Metro Manila. Prices change: read the live store before quoting one.

Audience: Filipino women roughly 25–45 with money to spend and English as their everyday language: office and work-from-home professionals, moms on the go, who want one good-looking everyday bag that zips shut and goes with every outfit. Upscale positioning: never compare YUMO to cheap or budget totes, never quote a competitor's price, avoid "looks expensive" (it implies the bag is not).

Social proof: none yet. Never invent ratings, review counts, customer quotes or "as seen in".

Ad angles in use: everything fits (kasya lahat), it zips (may zipper), the corporate girlie bag, arrives tomorrow (bukas dating), what is inside (zip pocket and key hook), keep one gift one.

Proof points: zip top with a small pull; lettered webbing stitched the full height of the bag; soft mid-weight cotton canvas that folds flat when empty (never "heavyweight", never "stands on its own"); an inside zip pocket; room for a 13–14-inch laptop; no outer pockets; ships within 24 hours. The key hook is The YUMO Tote's only; the pinstripe lining is The Lettered Tote's only.

Benefit lines that work: Beautifully made. Zips shut. Arrives tomorrow. · Zipped, on the shoulder, hands free. · Everything, actually. · Monday to Sunday. · Keep one, gift one. · Carry it well.

Tone: English, quiet, confident, premium and understated, like a label introducing itself rather than a seller; Taglish only when an ad is deliberately casual. Ads may sell, with every price taken from the lines above.

Visual identity: the wordmark is "YUMO." in a refined high-contrast serif with a moss full stop, ink on paper or white on dark photos. Headlines in an elegant serif, text in a clean humanist sans-serif. Palette: ink #17160F, paper #FAF8F4, bone #EDE7DB, stone #7D7769, moss #4B5443 (accents and the full stop only). Editorial fashion photography in natural daylight: the bag on a real Filipina model's shoulder on a Manila street, at a café or a desk, or on a clean studio surface. Never candy colours, never a discount-sticker look.

Compliance: the lettering printed on The Lettered Tote is a third-party wordmark; it appears on the bag as in its photo, but is never typed, named or spelled in a headline, caption, description or any text on the ad; the product is "The Lettered Tote". No "heavyweight canvas", no "stands on its own", no laptop size above 14 inches, no ratings, review counts or press mentions until real. Measurements are approximate until tape-measured.$profile$,
       updated_at = now()
 where store = 'YUMO';

-- File every photo under its product; null would mean "shared by both".
update public.remake_brand_images set product = 'The Lettered Tote'
 where store = 'YUMO' and (label like 'yumo-tote-%' or label like 'yumo-lettered-%') and product is distinct from 'The Lettered Tote';
update public.remake_brand_images set product = 'The YUMO Tote'
 where store = 'YUMO' and label like 'yumo-own-tote-%' and product is distinct from 'The YUMO Tote';
update public.remake_brand_images set kind = 'bag'
 where store = 'YUMO' and kind is distinct from 'bag';

-- Cream is no longer sold: kept in the kit, never attached to a static ad.
update public.remake_brand_images
   set ad_use = 'skip', description = 'OLD colour (Cream, no longer sold) — not used in ads'
 where store = 'YUMO' and label in ('yumo-tote-pair-black-cream.jpg', 'yumo-tote-cream-front.jpg');

-- The pack each product's static ads reproduce.
update public.remake_brand_images set ad_use = 'main', pack_spec = null
 where store = 'YUMO' and label in ('yumo-lettered-pair-black-khaki.jpg', 'yumo-own-tote-on-shoulder.jpg') and ad_use is distinct from 'main';
update public.remake_brand_images set ad_use = null
 where store = 'YUMO' and label = 'yumo-tote-black-front.jpg' and ad_use = 'main';

-- Descriptions that say what the photo shows without spelling the third-party lettering.
update public.remake_brand_images d set description = v.description
  from (values
    ('yumo-lettered-pair-black-khaki.jpg', 'Front of The Pair: a Black and a Khaki lettered canvas tote side by side, cream lettered straps'),
    ('yumo-lettered-khaki-front.jpg', 'Front of the Khaki lettered tote: sand canvas, lighter cream lettered straps, dark print'),
    ('yumo-tote-black-front.jpg', 'Front of the Black lettered tote: black canvas, cream lettered straps, white two-line print'),
    ('yumo-tote-black-held.jpg', 'Front of the Black lettered tote held by its straps in a hand'),
    ('yumo-tote-inside-pinstripe-zip-pocket.jpg', 'Inside of the lettered tote: black-and-white pinstripe lining and the inside zip pocket'),
    ('yumo-tote-black-flat-detail.jpg', 'Front of the Black lettered tote laid flat, close on the print and the lettered straps'),
    ('yumo-tote-black-real-photo.webp', 'Front of the Black lettered tote, real unit photo'),
    ('yumo-tote-black-real-flatlay.webp', 'Front of the Black lettered tote, real unit flat lay'),
    ('yumo-own-tote-on-shoulder.jpg', 'Front of The YUMO Tote on a shoulder: black canvas, white YUMO print, cream YUMO-lettered straps'),
    ('yumo-own-tote-front-flat.jpg', 'Front of The YUMO Tote laid flat, close on the white YUMO print and the lettered straps'),
    ('yumo-own-tote-inside.jpg', 'Inside of The YUMO Tote: cream zip top, inside zip pocket and the brass key hook'),
    ('yumo-own-tote-keyholder.jpg', 'Inside detail of The YUMO Tote: the antique-brass key hook on its canvas tab')
  ) as v(label, description)
 where d.store = 'YUMO' and d.label = v.label and d.description is distinct from v.description;
