-- NURTELLE price change (2026-11-22): 1 carton ₱729, 2 ₱1,190, 3 ₱1,490, 5 ₱1,990.
-- The Brand Kit profile is where the Static Ad Generator reads prices from.
update public.remake_brand_kits
   set profile = replace(
                   replace(
                     profile,
                     'Price: ₱990 for 30 patches.',
                     'Price: ₱729 for one carton of 30 patches. Bundles: 2 cartons ₱1,190 · 3 cartons ₱1,490 · 5 cartons ₱1,990 (₱398 a carton).'
                   ),
                   'was ₱1,990 → now ₱990 (50% off)',
                   'was ₱1,990 → now ₱729 (63% off)'
                 ),
       updated_at = now()
 where store = 'NURTELLE'
   and profile like '%Price: ₱990 for 30 patches.%';
