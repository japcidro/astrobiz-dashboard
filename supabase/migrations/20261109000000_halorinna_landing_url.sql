-- HALORINNA's saved landing URL was "www.tryhalorinna.shop", without a
-- scheme, so its ads sent shoppers to http://www.tryhalorinna.shop/ and
-- through two redirects (to https, then to the apex primary domain). The
-- primary domain answers directly. Idempotent.

update public.store_ad_defaults d
   set website_url = 'https://tryhalorinna.shop/', updated_at = now()
  from public.shopify_stores s
 where s.id = d.shopify_store_id
   and upper(s.name) = 'HALORINNA'
   and d.website_url in ('www.tryhalorinna.shop', 'http://www.tryhalorinna.shop', 'http://www.tryhalorinna.shop/');
