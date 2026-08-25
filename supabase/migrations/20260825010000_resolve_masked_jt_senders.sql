-- Resolve J&T-redacted sender names on parcels already in the table.
--
-- J&T began masking the sender name in its exports around May 2026, writing
-- "I******" and "C******" instead of the real name. matchSenderToStore fell
-- through to its raw-name branch, so 942 parcels landed under those literal
-- strings — showing up on the J&T dashboard as unknown senders, and splitting
-- each store's delivery/RTS stats across two rows.
--
-- store-matching.ts now recovers the store from the surviving prefix, but only
-- for new uploads. This repairs the rows already written.
--
-- The prefix resolution is safe because every store's first letter is unique
-- (I LOVE PATCHES, CAPSULED, FOLIQ, HIBI, SERINA), and the parcels' own item
-- names confirm it independently: 842 of the 884 "I******" rows are
-- glowup-patch (an I LOVE PATCHES product) and all 58 "C******" rows are
-- airtek-* (CAPSULED products).
--
-- Idempotent: after this runs, no row matches the patterns any more.

update public.jt_deliveries
   set store_name = 'I LOVE PATCHES'
 where store_name ~ '^I\*+$';

update public.jt_deliveries
   set store_name = 'CAPSULED'
 where store_name ~ '^C\*+$';
