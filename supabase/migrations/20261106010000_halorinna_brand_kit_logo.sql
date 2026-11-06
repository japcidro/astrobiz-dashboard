-- HALORINNA brand kit: the launch logo settled the palette.
--
-- The logo is the carton wordmark (the mark printed on the box), traced to
-- vector on 2026-11-06; its ink measures #c10743, a touch deeper than the
-- site's accent #d8175c. The Facebook avatar is the wordmark's own H, dot and
-- smile as a monogram, white on #c10743. The profile's visual-identity
-- paragraph and the rules now say so, so the Static Ad Generator, Script
-- Generator and Clipper reproduce the mark instead of retyping it. Idempotent.

update public.remake_brand_kits
   set profile = replace(
         profile,
         'Palette: magenta #d8175c, deep raspberry #93103f, soft pink, white.',
         'Logo: the carton wordmark HALORINNA in rounded geometric capitals (custom two-bar H, dotted i, a dot after the final A, a smile curve under INNA), ink #c10743 on white or white on #c10743; the avatar is its H-dot-smile monogram. Palette: logo magenta #c10743, site magenta #d8175c, deep raspberry #93103f, blush #fbf4f6, white.'
       ),
       updated_at = now()
 where store = 'HALORINNA'
   and profile like '%Palette: magenta #d8175c, deep raspberry #93103f, soft pink, white.%';

update public.remake_brand_kits
   set rules = rules || ' The HALORINNA wordmark is reproduced exactly as printed on the box (magenta #c10743 on white, or white on magenta), never retyped in a font or redrawn.',
       updated_at = now()
 where store = 'HALORINNA'
   and rules not like '%wordmark is reproduced exactly%';
