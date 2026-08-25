-- Same redaction fix as 20260825010000, applied to the upload history summary.
--
-- jt_upload_batches.stores is snapshotted at upload time, so the batch covering
-- May 10-31 recorded "I******" and "C******" alongside the real names. Fixing
-- jt_deliveries left that summary untouched, and the Upload History table
-- renders the array verbatim — so the masks were still on screen.
--
-- Idempotent: the guard means a second run matches nothing.

update public.jt_upload_batches
   set stores = (
     select coalesce(array_agg(distinct resolved order by resolved), '{}')
     from (
       select case
                when s ~ '^I\*+$' then 'I LOVE PATCHES'
                when s ~ '^C\*+$' then 'CAPSULED'
                else s
              end as resolved
       from unnest(jt_upload_batches.stores) as s
     ) x
   )
 where exists (
   select 1 from unnest(stores) as s where s ~ '^[A-Za-z]+\*+$'
 );
