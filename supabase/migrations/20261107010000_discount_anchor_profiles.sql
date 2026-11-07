-- Static ads: the "was" price is the brand's highest regular price.
--
-- The Static Ad Generator planner now anchors every crossed-out price and
-- % off on the brand's HIGHEST regular price, so the discount shown is the
-- biggest the brand runs (₱2,990 → ₱990, not ₱1,490 → ₱990). Each brand
-- profile gets an explicit "Discount anchor" line right after its price
-- line so the planner, the copy suggester and the Script Generator all read
-- the same pair. I Love Patches' pair is the one the owner gave; the others
-- are each brand's highest listed regular price against its entry price.
-- Idempotent: a profile that already carries the line is left alone.

create or replace function pg_temp.add_anchor(p_store text, p_line text) returns void as $$
begin
  update public.remake_brand_kits
     set profile = regexp_replace(profile, '(Price:[^\n]*)', E'\\1\n' || p_line),
         updated_at = now()
   where store = p_store
     and profile like '%Price:%'
     and profile not like '%Discount anchor%';
end;
$$ language plpgsql;

select pg_temp.add_anchor('I Love Patches', 'Discount anchor (the "was" price every ad shows, against the entry price): was ₱2,990 → now ₱990 (67% off).');
select pg_temp.add_anchor('FOLIQ',          'Discount anchor (the "was" price every ad shows, against the entry price): was ₱1,980 → now ₱990 (50% off).');
select pg_temp.add_anchor('NURTELLE',       'Discount anchor (the "was" price every ad shows, against the entry price): was ₱1,990 → now ₱990 (50% off).');
select pg_temp.add_anchor('HALORINNA',      'Discount anchor (the "was" price every ad shows, against the entry price): was ₱4,950 → now ₱990 (80% off).');
