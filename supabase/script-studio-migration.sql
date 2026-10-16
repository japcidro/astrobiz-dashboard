-- Script Generator (Marketing Tools): a winning video ad's script in, our
-- brand's version out. Claude studies the reference script (what won: the
-- hook move, the beat order, the language mix, the tone), maps every beat to
-- our line from the brand kit profile, writes N versions, and reviews each
-- one with scores; a fixable review gets one automatic rewrite.
--
-- The Winning DNA is a per-brand brief Claude writes from the brand's own
-- deconstructed video ads (ad_creative_analyses) joined to their purchases
-- (the cached ads_v3 payloads, aggregated by script_studio_ad_metrics). The
-- adapter uses it only to fill what the reference cannot give us: our
-- mechanism, our proof timeline, our CTA wording, the compliance phrasing.
--
-- Service-role only (RLS on, no policies), like the other tools.
--
-- Run with:  npm run db:run -- supabase/script-studio-migration.sql

create table if not exists script_studio_runs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references marketing_board_items (id) on delete set null,
  store text not null,
  reference_text text not null,                 -- the reference ad's script, as adapted
  reference_label text not null default '',
  reference_source text not null default 'paste' check (reference_source in ('paste', 'board', 'winner')),
  notes text not null default '',
  versions int not null default 2 check (versions between 1 and 4),
  study jsonb,                                  -- what won in the reference (Claude)
  plan jsonb,                                   -- their line -> our line, every beat (Claude)
  dna_built_at timestamptz,                     -- which Winning DNA the run used
  error text,
  created_by uuid references employees (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists script_studio_runs_item_idx on script_studio_runs (item_id, created_at desc);
create index if not exists script_studio_runs_created_idx on script_studio_runs (created_at desc);

create table if not exists script_studio_scripts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references script_studio_runs (id) on delete cascade,
  idx int not null default 0,
  status text not null default 'writing' check (status in ('writing', 'done', 'failed')),
  title text not null default '',
  hook text not null default '',
  beats jsonb not null default '[]'::jsonb,     -- [{t, line, on_screen, visual}]
  cta text not null default '',
  seconds numeric,
  script_text text not null default '',         -- the whole script as plain text, for copying
  review jsonb,                                 -- {ok, fixable, scores:{hook,structure,language,compliance,brand}, notes}
  attempts int not null default 1,
  kept boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists script_studio_scripts_run_idx on script_studio_scripts (run_id, idx);

create table if not exists script_brand_dna (
  store text primary key,
  dna text not null,
  built_from jsonb not null default '[]'::jsonb, -- [{ad_id, ad, purchases, spend, cpa, verdict, hook, transcript}]
  built_at timestamptz not null default now(),
  built_by uuid references employees (id) on delete set null
);

alter table script_studio_runs enable row level security;
alter table script_studio_scripts enable row level security;
alter table script_brand_dna enable row level security;

drop trigger if exists script_studio_scripts_touch on script_studio_scripts;
create trigger script_studio_scripts_touch before update on script_studio_scripts
  for each row execute function hook_studio_touch();

-- Every ad's lifetime-ish metrics from the cached ads_v3 payloads: the
-- week-long ranges the Ad Performance page has viewed (Sun-Sat, no overlap),
-- plus the single days after the last of them; last_30d when no ranges
-- have been viewed. Summed in Postgres so the 6 MB payloads never leave it.
create or replace function script_studio_ad_metrics()
returns table (
  ad_id text,
  ad text,
  campaign text,
  adset text,
  account text,
  purchases bigint,
  spend numeric,
  revenue numeric,
  impressions bigint,
  created_time text
)
language sql
stable
as $$
  with keys as (
    select cache_key,
           substring(cache_key from 'range:(\d{4}-\d{2}-\d{2}):') as f,
           substring(cache_key from 'range:\d{4}-\d{2}-\d{2}:(\d{4}-\d{2}-\d{2})$') as t
    from cached_api_data
    where cache_type = 'ads' and cache_key like 'ads_v3:account=ALL&date_preset=range:%'
  ),
  weekly as (select cache_key, f, t from keys where f <> t),
  daily as (select cache_key from keys where f = t and f > (select max(t) from weekly)),
  chosen as (
    select cache_key from weekly
    union all select cache_key from daily
    union all
    select cache_key from cached_api_data
    where cache_key = 'ads_v3:account=ALL&date_preset=last_30d' and not exists (select 1 from weekly)
  )
  select e->>'ad_id',
         max(e->>'ad'),
         max(e->>'campaign'),
         max(e->>'adset'),
         max(e->>'account'),
         coalesce(sum((e->>'purchases')::numeric), 0)::bigint,
         coalesce(sum((e->>'spend')::numeric), 0),
         coalesce(sum((e->>'roas')::numeric * (e->>'spend')::numeric), 0),
         coalesce(sum((e->>'impressions')::numeric), 0)::bigint,
         max(e->>'created_time')
  from cached_api_data c
  join chosen u on u.cache_key = c.cache_key
  cross join lateral jsonb_array_elements(c.response_data->'data') e
  where e->>'ad_id' is not null
  group by e->>'ad_id'
$$;

-- A first Winning DNA for FOLIQ, written by hand on 17 Oct 2026 from the 19
-- deconstructed FOLIQ video ads joined to their purchases (Apr-Oct 2026).
-- "Rebuild from winners" on the page replaces it with Claude's own reading
-- of the same data.
insert into script_brand_dna (store, dna, built_from, built_at)
values (
  'FOLIQ',
  $dna$WINNING DNA · FOLIQ video ads (hand-written seed, 17 Oct 2026; 19 deconstructed ads, ₱790k spend, 1,773 purchases, blended ₱445 per purchase)

WHAT A WINNER LOOKS LIKE (₱231-₱420 per purchase, 25-262 purchases each)
- The product is named within the first 3 seconds, or the hook is a blunt claim about the cause. The biggest winner opens "Anong mangyayari pag uminom ka ng FOLIQ for 3 months?" (262 purchases, ₱380). Other winning openers: "So this is my androgenetic alopecia update" (110, ₱417), "The result I didn't plan for" (70, ₱361), "Cortisol yung dahilan kung bakit ka nakakalbo" (57, ₱231, the best CPA), "What happens when you take FOLIQ for three months?" (44, ₱383), "Give me three months to bring your hair back" (25, ₱319).
- Long is fine: the two biggest winners run 117 s and 83 s. Nothing under 50 s won.
- Taglish, Tagalog-leaning, man-to-man, a little blunt. Science words stay English (DHT, cortisol, follicles, shedding phase, saw palmetto); feelings and the story go Tagalog ("napapanot na ako guys", "kaya pala walang nangyari", "bumalik na yung confidence ko").
- Proof that works: the same person before and after, tied to his own story (split screen "DAY 1 / DAY 90", "3 months ago"). Raw single-take UGC with few cuts still wins.

THE SPINE every winner runs, in this order
1. Hook (product named, or the cause claim).
2. Reframe: "akala ng marami, kapag numinipis ang buhok mo, edad o genetics lang 'yan. Pero hindi lang 'yun."
3. Two causes: DHT ("yung hormone na unti-unting pinapaliit ang follicles mo") and cortisol ("yung stress hormone galing sa trabaho, kulang na tulog, deadlines; pag chronically stressed ka, itinutulak niya yung buhok mo papasok sa shedding phase ng mas mabilis").
4. Validation, the engine of the ad: "kaya pala walang nangyari sa mga sinubukan mo dati: minoxidil, finasteride, derma rolling, anti-hairfall shampoo. DHT lang ang inaatake nila. Kulang." Then: "FOLIQ targets both."
5. Ingredients mapped to a cause: "Saw palmetto and pumpkin seed support healthy DHT levels. Ashwagandha supports a healthy cortisol response. Biotin for strand strength. Four ingredients, all backed by clinical research." Ease: "Two capsules a day, that's it. Walang ipapahid, walang prescription."
6. Timeline: "After ilang araw / first week, mas konti na yung nalalagas sa unan. By month two, mas makapal na yung strands. Around month three, bumabalik na yung confidence" (or "hindi mo na kailangan ng cap").
7. Close: "Two capsules a day. 30-day risk free, libreng delivery nationwide. Link below." Optional closer that several winners share: "Ikaw ang magdedesisyon kung gaano karaming buhok pa yung matitira sa'yo limang taon from now, hindi yung DHT at cortisol." Softer close also wins: "check out Foliq, link below."

WHAT LOST (₱540-₱783 per purchase)
- Story or fear hooks that hold the product back: "my dad at 32 / me at 32", "I almost took finasteride", "I started losing my hair at 27, dude". Same body as the winners, worse cost every time.
- Proof without a person: a MONTH 0 / MONTH 1 montage with a voice-over and no story (₱562).
- Short cuts (41-56 s) that drop the timeline or the validation line.

COMPLIANCE WORDING (the newer winners use this; older ads said "block DHT" / "lowers cortisol")
- Say "support healthy DHT levels", "supports a healthy cortisol response", "for strand strength", "helps", "supports". Never "cure", "block", "reverse", "guaranteed results", no doctor or dermatologist claims, no invented percentages or studies. "Still consult your derma" is a line a winner used and is welcome.
- The bottle label reads "FOOD SUPPLEMENT · NO APPROVED THERAPEUTIC CLAIMS"; keep it visible when the bottle is on screen.

BRAND FACTS (from the brand kit; never invent others)
- FOLIQ Hair Recovery Stack: one white bottle, 30 capsules (500 mg), two capsules a day. ₱990 (regular ₱1,980). Free shipping. 30-day money-back guarantee, no forms. 4.8/5 from 4,963+ reviews. "Your follicles aren't dead. They're asleep."$dna$,
  '[]'::jsonb,
  '2026-10-17T00:00:00+08:00'
)
on conflict (store) do nothing;

notify pgrst, 'reload schema';
