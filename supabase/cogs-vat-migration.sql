-- COGS: VAT on top of the supplier price.
--
-- cogs_per_unit stays the price on the supplier's invoice. vat_rate is the
-- fraction the P&L adds on top when it costs a unit — 0.12 for a
-- VAT-registered supplier, 0 when the price already includes it or the
-- supplier is not VAT-registered. The default of 0 leaves every existing
-- row's effective cost exactly as it was.
alter table cogs_items
  add column if not exists vat_rate numeric(5,4) not null default 0
  check (vat_rate >= 0 and vat_rate < 1);

-- FOLIQ's FLQ was entered at the pre-VAT invoice price of 182.00. With the
-- 12% on top it costs 203.84 a unit, which is what the P&L should have been
-- charging all along.
update cogs_items
set vat_rate = 0.12, updated_at = now()
where upper(store_name) = 'FOLIQ' and upper(sku) = 'FLQ';
