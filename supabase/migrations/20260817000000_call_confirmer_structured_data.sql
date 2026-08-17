-- Call Confirmer: store Vapi's structured extraction alongside each attempt.
--
-- Before this, the only record of what happened on a call was `ai_summary`
-- (English prose about a Taglish conversation) and the raw transcript. A
-- corrected delivery address spoken by the customer was captured nowhere —
-- the agent said "na-note ko na" and the information was lost.

alter table public.call_attempts
  add column if not exists structured_data jsonb,
  add column if not exists address_confirmed boolean,
  add column if not exists corrected_address text;

comment on column public.call_attempts.structured_data is
  'Raw analysis.structuredData from Vapi: confirmed / address_correct / corrected_address / needs_human / reason.';
comment on column public.call_attempts.address_confirmed is
  'True if the customer confirmed the delivery address, false if they said it was wrong, null if never discussed.';
comment on column public.call_attempts.corrected_address is
  'Address the customer gave when the one on file was wrong. Requires human verification — never written back to Shopify automatically.';

-- The VA queue filters on attempts needing follow-up; a corrected address is
-- one of the main reasons an attempt lands there.
create index if not exists call_attempts_corrected_address_idx
  on public.call_attempts (store_id)
  where corrected_address is not null;
