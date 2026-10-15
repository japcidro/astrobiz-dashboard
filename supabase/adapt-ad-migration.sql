-- Image Studio "adapt an ad" skill: a brand profile per store (what the
-- planner knows about the brand), the plan a run was generated from, and
-- an attempt counter so the reviewer can regenerate a result once.
--
-- Run with:  npm run db:run -- supabase/adapt-ad-migration.sql

alter table remake_brand_kits add column if not exists profile text not null default '';
alter table image_studio_runs add column if not exists plan jsonb;
alter table image_studio_results add column if not exists attempts int not null default 1;

insert into remake_brand_kits (store, rules, profile) values ('FOLIQ', '', '') on conflict (store) do nothing;

update remake_brand_kits set profile = $profile$
Brand: FOLIQ (tryfoliq.shop). Product: FOLIQ Hair Recovery Stack, a DHT + Cortisol recovery supplement for thinning and balding hair. One white bottle, 30 capsules (30 x 500mg), two capsules a day.
Audience: Filipino men 25–45 noticing a receding hairline, thinning crown or shedding; busy, skeptical of topicals and prescriptions.
Price: ₱990 (regular ₱1,980, 50% off). Fast & free shipping. 30-day money-back guarantee, no forms.
Social proof: 4.8/5.0 from 4,963+ reviews.
Core angle: every other product goes after DHT only; FOLIQ targets both DHT and CORTISOL (the stress hormone that keeps follicles asleep). "Your follicles aren't dead. They're asleep."
Proof points: 4 clinically studied ingredients: Ashwagandha KSM-66 (cortisol), Saw Palmetto (DHT), Pumpkin Seed Extract (DHT), Biotin (strand strength). No prescription, no clinic, no scalp routine, no residue. Clean formula, no fillers. Formulated for Filipino men.
Benefit lines that work: Stops DHT at the source · Boosts hair regrowth · Targets cortisol, what others ignore · Supports thicker, denser hair · Best for receding hairline and thinning hair.
Tone: direct, confident, man-to-man, a little blunt; English or Taglish (English with natural Tagalog, Manila style). Never medical promises.
Visual identity: white bottle with a deep teal band and a teal follicle-wave logo mark, black label text. Palette: deep teal #0F4C45, warm cream #F3E9D8, stone/beige, white, black. Warm natural light, earthy premium surfaces (stone, linen, wood). Headlines in bold condensed white or teal sans-serif. Premium but real, never clinical-blue or neon.
Compliance: the label always reads "FOOD SUPPLEMENT · NO APPROVED THERAPEUTIC CLAIMS"; keep that line visible on the bottle. No doctor or dermatologist claims, no "cure", no guaranteed results.
$profile$ where store = 'FOLIQ';
