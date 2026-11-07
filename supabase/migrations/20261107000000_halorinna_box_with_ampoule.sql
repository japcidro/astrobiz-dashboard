-- HALORINNA static ads: the box is shown together with the ampoule.
--
-- The first Static Ad Generator run reproduced the carton alone, because the
-- photo marked "main pack" was the box front. The customer has to see what
-- the actual product is, so the pack to reproduce is now the box with its
-- ampoules (the real photo and the site render, the two the planner may
-- attach), the box-only photos are skipped for static ads, the ampoule shots
-- carry the new "ampoule" form (what is inside the box, attached for scenes
-- that show it), and the brand rules say so in words. Idempotent.

update public.remake_brand_images
   set ad_use = 'main'
 where store = 'HALORINNA'
   and label in ('halorinna-box-and-ampoules-photo.jpg', 'halorinna-box-with-ampoules.jpg')
   and ad_use is distinct from 'main';

update public.remake_brand_images
   set ad_use = 'skip'
 where store = 'HALORINNA'
   and label in ('halorinna-box-front-photo.jpg', 'halorinna-box-front.jpg')
   and ad_use is distinct from 'skip';

update public.remake_brand_images
   set kind = 'ampoule'
 where store = 'HALORINNA'
   and label in ('halorinna-ampoules-x5.jpg', 'halorinna-ampoule-cutout.png', 'halorinna-ampoule-in-hand.jpg')
   and kind is distinct from 'ampoule';

update public.remake_brand_kits
   set rules = rules || ' Every static ad shows the box together with at least one ampoule — pink single-use ampoules standing beside or in front of the box, or one held in a hand — so the customer sees what the actual product is; never the box alone.',
       updated_at = now()
 where store = 'HALORINNA'
   and rules not like '%never the box alone%';
