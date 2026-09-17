# Astrobiz Dashboard — Changelog

## 2026-09-18: Clearing out the campaigns a failed promote left behind

Admin → Settings → Scaling Campaigns gains an **Empty campaigns** panel.
Scan the ad accounts, see what is safe to remove, archive or delete it
without leaving the dashboard.

Removing an ad campaign is not something to offer on trust, so it is gated
on evidence rather than on intent. A campaign is listed only when it could
not possibly be doing anything:

- no ads in it at all,
- never spent, and never delivered an impression — spend can round to zero,
  impressions cannot,
- every ad set paused (CAMPAIGN_PAUSED and ADSET_PAUSED count as paused),
- not already archived or deleted,
- and never the campaign a store scales into.

Anything failing one of those is not shown and cannot be removed through
this endpoint, whatever the client asks for. The rule lives in one module
that both the listing and the action import, and the action re-reads the
campaign from Graph and re-applies it immediately before touching anything
— a list a few minutes old is not evidence that a campaign is still empty.
Both routes are admin-only, which is stricter than the marketing-and-admin
access the rest of the promote flow uses.

**Archive** is offered first and is what the wording steers towards: it
leaves every dropdown and Ads Manager's default view, and comes back if it
turns out to be wanted. **Delete** is there too, in red, behind its own
confirmation that says plainly that nobody can undo it.

Scanning is one expanded Graph read per ad account — ads, ad sets and
lifetime insights come back with the campaigns rather than as a call each —
but it is still a heavy read, so it runs on the button and not on page load.

## 2026-09-18: One failed batch, three identical campaigns

Promoting three ads into a new campaign left three campaigns called
NURTELLE-SCALING behind. The bulk run is built to create the campaign once
— the first ad creates it, the response hands back `created_campaign_id`,
every ad after that joins it by id — and that worked for the two failure
paths it was written against. It did not work for the one that actually
fired.

The campaign and the ad set are created *before* the ad is copied, and they
survive a failed copy. But the ad-copy failure response — the long one with
the Facebook diagnostic probe attached — never carried `created_campaign_id`
or `created_adset_id`. So each ad reported failure, the next ad saw no
campaign to join, and built its own. Three ads, three campaigns, three
ad sets, no ads.

Every exit after something is created now reports what it created: the
ad-copy failure, the diagnostic path, and the outer catch. The modal claims
those ids from failures as well as successes, for the shared ad set as well
as the campaign.

A thrown request is the one case that still can't be reasoned about — it
may have created a campaign before dying — so the run stops there instead
of guessing, and says to check Ads Manager before retrying.

Nothing created this way was ever going to spend: a cloned ad set is always
created PAUSED and only the *ad* honours "Activate immediately", so an
orphan campaign holds a paused ad set and, when the copy failed, no ads.
Clutter, not spend. Still worth not making.

And because Meta will happily hold ten campaigns with the same name, the
new-campaign name field now says when one already exists in that ad account
— and how many — with a nudge to pick it from the list above instead.

## 2026-09-18: When a promote fails, say why — and stop repeating it

Three ads into a new campaign, three red "Failed" badges, and the reason
only readable by hovering one of them. The error was there the whole time,
in a `title` attribute.

- **The error prints under the ad name**, wrapped, in red, in place of the
  "from ADSET" line. A failed row is the one row anyone needs to read.
  "Copy the error messages" puts all of them on the clipboard.
- **A failure that will repeat stops the run.** Creating the campaign and
  cloning the first ad set is the same work for every ad in the batch, so
  when it fails for the first ad it fails identically for the rest. The
  route marks those `setup_failed`; the modal shows the message once, marks
  the remaining ads skipped, and stops — instead of spending two more API
  calls proving the same point.

And the most likely reason it was failing at all: **a new campaign was
modelled on the wrong campaign.** Its objective and special ad categories
came from the store's mapped scaling campaign, or — for a store with no
mapping — from the source ad's own campaign. Neither is the one that
matters. The ad set being cloned into the new campaign has to be able to
live there, and Meta refuses to move an ad set between campaigns whose
objectives differ, so the model has to be the *template ad set's* campaign.
It is now, ahead of both older guesses.

When Meta refuses anyway, it does so with "Invalid parameter" and no
subcode. The route now reads both campaigns and names the mismatch itself —
"the ad set you cloned lives under a OUTCOME_LEADS campaign but X is
OUTCOME_SALES, and Meta cannot move an ad set between campaigns with
different objectives" — and, when a campaign was created before the clone
failed, says it is sitting there empty rather than leaving it to be found
later in Ads Manager.

## 2026-09-18: Say what the destination options actually do

"→ New adset", "+ New per ad (named after source)", and a third option
greyed out with "type a name below first" — pointing at a field the user
had to scroll past the ad list to find. Three ways of saying "ad set" and
none of them saying what happens to the ad.

The options now describe the outcome, in the same words in both places:

- **Into one shared new ad set: "NAME"** — every ad sent here lands in the
  same new ad set, learning together on one budget.
- **Into its own new ad set: "AUTISTIC"** — one ad set per ad, named after
  the ad set it came from, quoting that name in the option itself rather
  than calling it "source".
- **Don't copy this ad**, and existing ad sets grouped under "Into an ad set
  that already exists".

The quick-apply row reads as a sentence — "Put every ad: in one shared ad
set · in its own ad set · in an ad set that exists… · nowhere (skip all)".

Neither new-ad-set option is greyed out any more. Disabling them hid the
choice behind a prerequisite whose explanation was elsewhere on screen;
they stay selectable and the footer names what is still missing, which it
already did for every other blocker.

The fields those options depend on — which ad set to copy targeting and
budget from, and the shared ad set's name — moved above the ad list, so the
modal reads in the order it is filled: where it goes, how the ad sets are
made, which ad goes where, paused or active. Nothing says "below first" any
more, because nothing is below.

## 2026-09-18: A store with no scaling campaign can still promote

Nurtelle is new. It has no scaling campaign, so it has no row in
store_scaling_campaigns, so it was not in the store dropdown — and the store
dropdown gated everything. Three NVP ads selected, three stores offered,
none of them Nurtelle's, "Pick a target store first" in the footer and no
way past it. The one thing that would have fixed it, creating a campaign,
sat behind the very gate that was blocking. A store could only promote once
it already had the thing promoting was supposed to create.

The store mapping is no longer a prerequisite anywhere in the flow. What
actually constrains a promote is the ad account — Meta's /copies cannot
leave one — and the source ad has always known its own. So:

- **`target_store` is optional on `/api/marketing/scaling/promote`.** With
  a store it behaves exactly as before: the mapped campaign is the default
  destination. Without one, the ad's own ad account is the destination
  account and `target_campaign_id` or `new_campaign` carries the rest. The
  cross-account guard now only applies where a mapping exists, because
  without one the destination *is* the source's account.
- **`/scaling/campaigns` and `/scaling/adsets` take `account_id`** as an
  alternative to `store`, so an unmapped account can still list what it has.
  `configured` comes back null there: no default destination, so the picker
  opens on "— Pick a campaign —" rather than silently claiming one.
- **The modals hang off the ad account.** The store row is still there, now
  optional, and lists only stores inside the ads' own ad account — a store
  mapped elsewhere was never a destination Meta would accept. When no store
  maps to the account it says so, and points at Admin → Settings for
  afterwards, when the ↑ SCALED badge becomes worth wiring up.
- **A new campaign's objective follows the campaign its first ad set is
  cloned from.** A purchase-optimised ad set cannot live under an awareness
  campaign, and with no scaling campaign to model, the clone source is the
  only signal available. The server keeps the same rule as a backstop,
  falling back to the source ad's own campaign, and refuses to inherit a
  legacy objective Graph reports but will not create.

The promote itself is unchanged: same /copies call, same PAUSED-by-default
ad sets, same badge rule — an ad copied outside a mapped scaling campaign
is not marked scaled.

## 2026-09-18: The campaign step was hidden behind a store nobody had picked

Shipping the campaign picker changed nothing on screen, because it only
rendered once a target store was chosen — and the store was almost never
chosen for you. The only derivation was matching a store name inside the
campaign name, which works for `CBO-CAPSULED` and fails for every campaign
named after a product instead of a store, which is most of them. Open the
bulk modal on a batch of `NVP-…` ads and you got the same "— Pick store —"
dropdown and the same "Pick a target store first" as before, with the whole
campaign step invisible behind it.

The store picker's real job is to name an ad account, and the source ad
already knows its own: Meta cannot copy across ad accounts, so the account
the ad lives in is the only one a copy could land in. Both modals now take
the source ad's `account_id` and resolve the store from it — an explicit
suggestion wins, then the ad account, then the old campaign-name match.
It declines to guess when the selection spans several ad accounts (no single
run could copy those anyway) or when one account maps to two stores.

The campaign picker also stops hiding. With no store resolved it renders
disabled, reading "Pick a target store first, then the campaign", so the
step is visible as a step rather than as nothing at all.

One ordering hazard came with it: Ad Performance refreshes in the
background and hands the open modal a new `subjects` array for the same
ads. Re-deriving on that would reset the store, and resetting the store
clears every per-ad destination already chosen — so derivation is keyed off
the ad accounts themselves and runs once per modal.

## 2026-09-17: Promote to scaling can choose a campaign, not just an ad set

Promote had one destination and never said so. Picking a store resolved the
campaign mapped to it in Admin → Settings, and the only question left was
which ad set inside that one campaign. Landing a winner anywhere else — a
second CBO, a fresh campaign for a new angle — meant leaving the dashboard
and duplicating it by hand in Ads Manager, which is precisely the trip the
promote button exists to save.

The destination is now two decisions, campaign then ad set, in that order.

- **Target campaign** sits under Target store in both promote modals. It
  opens on the store's scaling campaign, so the existing path is unchanged
  and still two clicks; below it sit every other campaign in the same ad
  account, and **+ Create a new campaign…**. In the bulk modal the store and
  campaign pickers moved *above* the ad list — they were underneath it,
  which asked people to choose a per-ad destination before the thing those
  destinations belong to had been chosen.
- **A new campaign** takes a name, an objective and an optional daily budget
  (set it and the campaign runs on CBO; leave it blank and budgets stay at
  the ad set level). The objective is pre-filled from the scaling campaign
  because it has to match the ad set being cloned into it or Meta rejects
  the clone — and it is pre-filled from our own list, never from whatever
  legacy objective Graph reports, since Meta still *reports* `CONVERSIONS`
  on old campaigns while refusing to *create* one with it.
- **The first ad set in a new campaign is a clone**, because Meta cannot
  create a blank one. A "Clone the first ad set from" picker chooses which
  campaign's ad sets to model it on, defaulting to the scaling campaign;
  the copy goes into the new campaign via `campaign_id` on Meta's ad set
  `/copies`.
- **A bulk run creates the campaign once.** The first ad creates it, the
  response hands back `created_campaign_id`, and every ad after that joins
  it by id — otherwise promoting twelve ads would have left twelve
  identically-named campaigns. The id is claimed even from a *failed* row,
  since the route creates the campaign before cloning the ad set and reports
  it when that clone is what broke; without that, every remaining row would
  have created another empty campaign chasing the same error.
- **The ad set choices follow the campaign.** Switching campaigns clears
  every per-row ad set pick — an id from the old campaign is not a
  destination in the new one — and while a campaign is still being created,
  "existing ad set" disappears entirely: the ad sets on screen are the
  template's, not destinations.

Server side, `/api/marketing/scaling/promote` takes `target_campaign_id` or
`new_campaign` and falls back to the mapped campaign when given neither, so
every existing caller is unaffected. Two guards changed shape: the target
ad set is now verified against the *destination* campaign rather than the
scaling one, and a template ad set only has to share an ad account with the
destination instead of sharing its campaign — cloning across campaigns is
the whole mechanism by which a new campaign gets its first ad set. Meta's
hard rule that `/copies` cannot cross ad accounts is still enforced, now on
the chosen campaign too. `/api/marketing/scaling/adsets` takes a
`campaign_id`, and a new `/api/marketing/scaling/campaigns` lists what a
store's ad account can offer.

One deliberate restraint: the "↑ SCALED" badge is still only written for
ads copied into the mapped scaling campaign. An ad promoted into some other
campaign is not scaled, and claiming otherwise would only be un-claimed by
the next detection cron half an hour later.

## 2026-09-17: Ad copy without a made-up ceiling, and bulk into an existing ad set

Two things the ad builders got wrong in opposite directions.

- **Create Ad was counting down to limits that are not real.** The three copy
  fields showed `n/125`, `n/40` and `n/30` and turned yellow past them. Those
  are Facebook's *truncation preview* thresholds, not field limits — a longer
  primary text is accepted and shown in full when the viewer taps "See more",
  and long-form copy is exactly what half the winning ads use. Bulk Create
  never had the counters, so the same copy pasted into the two screens got two
  different verdicts. Create Ad now shows a plain neutral character count and
  nothing is ever marked as too long. Nothing was ever truncated or blocked on
  submit — the limit only existed as a warning that made people rewrite good
  copy.
- **Bulk Create could not add ads to an ad set that already exists.** Its mode
  toggle offered New Campaign and Existing Campaign only, and every row always
  built a fresh ad set — so topping up a proven, already-learning ad set with
  five new creatives meant running the single Create Ad wizard five times. A
  third mode, **Existing Ad Set**, picks a campaign, then an ad set under it
  (paused ones listed with their status, like the single wizard), and puts
  every row in it. In that mode Section B collapses to a note — an existing ad
  set brings its own budget, schedule and targeting, and sending a template
  would only invite a rejection — and the per-row "Adset Name" column
  disappears, since there is no ad set left to name. The server already spoke
  `existing_adset`; only the bulk screen never offered it.


## 2026-09-17: Ad Performance — readable names, and a real date range

Two things on `/marketing/ads`.

- **The campaign name was losing its own column.** Up to five chips —
  `DISAPPROVED`, `ISSUES`, `N/M ON`, the budget, `↑ N/M SCALED` — sat in the
  name cell as `flex-shrink-0` siblings of a truncating name inside a 350px
  cell. On a campaign with 431 ads the chips took the whole width and the name
  rendered as nothing at all. The health indicators moved to the count column,
  which was right-aligned and near-empty, and shrank to `⛔ 1 · ⚠ 1 · ↑ 62`
  next to the count itself; the count now carries the on/off state as colour
  (`14/431` yellow for partial, green when all on, grey when all off) instead
  of a separate chip. Same tooltips, same information, and the name gets the
  column back.

  Then that compression went too far the other way: `↑ 1` sitting beside a
  bare `1` in the same cell is two numbers and no sentence, and nobody should
  have to decode their own dashboard. Final shape gives each thing a column
  of its own — **Flags**, **Budget**, then the count. Flags spells out what is
  wrong in words (`⛔ 1 REJECTED`, `⚠ 1 ISSUE`, `SCHEDULED`, `↑ 1 SCALED`) and
  is **blank on a healthy row**, so scanning hundreds of ad sets the eye only
  catches the ones that want attention. The count is one number pair,
  `live/total`, coloured to say the same thing twice.
- **Custom date range.** The seven presets are whatever Facebook happens to
  name, which is no help when you want "the 3rd to the 11th". A `Custom` chip
  now opens two date pickers bounded by today in PHT — the timezone the
  insight windows are actually bucketed by. The range is applied with a button
  rather than on every keystroke: the warm-cache cron only covers the presets,
  so an unseen range costs a full multi-account Facebook walk, and that should
  happen once when the user is done choosing, not once per edit. `/all-ads`
  already spoke `date_from`/`date_to` (briefings use it to backfill history);
  it now validates the pair, and extends the today-merge — the patch that
  rescues ads created today from a multi-day window's aggregation — to any
  explicit range that is still running today.


## 2026-09-17: "User request limit reached" — the rate-limit defenses were never running

Ad Performance stopped loading after NURTELLE joined as a third ad account.
The account was not the cause; it was the straw. Every guard built to keep us
under Facebook's call budget was already inert, so the dashboard had been
paying full price for every page view and two accounts' worth of calls just
happened to fit under the ceiling.

Four failures, each of which alone would have been survivable.

- **The warm cache was never read. Not once.** `/api/facebook/all-ads` keyed
  its cache on `include_zero_spend`. The cron warmed `zero=0`; the ads page,
  the creatives page and the winners pool all request `include_zero_spend=1`
  and read `zero=1`. So the half-hourly cron spent a full multi-account walk
  six times an hour writing an entry nothing ever read, and every page view
  missed and re-walked all three accounts live. The key no longer carries
  `zero`: one entry stores the superset and `shapeForZeroSpend` trims it per
  caller. The two variants always cost identical Facebook calls — only the
  response differed — so there was never a reason to fetch them separately.
- **RLS was silently denying every write the protections depended on.**
  `cached_api_data` is admin-only, and `fb_rate_limit_state` / `fb_refresh_state`
  grant `SELECT` with no `INSERT`. The route did all of it through the caller's
  session client and swallowed the errors. Consequences: a marketing-role user
  cold-fetched Facebook on every single page load; the 429 backoff never
  recorded a block, so nothing ever backed off; and the manual-refresh throttle
  never stored a timestamp, so Refresh was effectively unthrottled and every
  click was another full walk. These tables are shared infrastructure, not
  caller data — they now go through the service client in both `/all-ads` and
  `/accounts`. Authorization still happens where it did, at the top of the
  route. `app_settings` stays on the session client; its RLS already covers
  both roles.
- **The structure cache lived in a `Map` on a serverless function.** Instances
  don't share process memory and cold starts wipe it, so the campaigns, adsets
  and ads fetches it was meant to prevent ran anyway — roughly fifteen
  paginated pages per account, since `?refresh=1` skipped the cache outright
  and the cron always passes it. It is in Supabase now, keyed per account for
  30 minutes. Structure is identical across date presets, so one cron run
  fetches it once instead of six times per account. A human pressing Refresh
  still bypasses it and gets live on/off statuses.
- **Today's rows were fetched five times over.** Every multi-day window patches
  itself with today's insights to catch ads FB omits from wide windows. Four of
  the six warmed presets do this, each with its own paginated fetch of the same
  rows. They now share one 20-minute entry, seeded by the `today` preset.

Two changes to what the dashboard is willing to spend:

- **A plain page view no longer refreshes.** If nothing fresh is cached it
  serves the cron's last payload flagged stale, up to 12 hours old, rather than
  spending a three-account walk on someone opening a tab. Only `?refresh=1` and
  the cron go to Facebook. The freshness window also moved from 30 minutes to
  45 — it used to equal the cron interval exactly, so any view landing in the
  gap between runs fell through to a live fetch.
- **The cron stops walking wide windows every half hour.** `today` and
  `yesterday` still refresh every run; `last_7d`, `last_14d`, `last_30d` and
  `this_month` warm hourly. They barely move between two runs.

Also: the cron re-cached each response under a second key (`ads:…`) that
nothing read — a multi-megabyte write per preset, now dropped — and it counted
a rate-limited refresh as a success. That is why the cache sat 18 hours stale
while every run reported `ok`; a stale or rate-limited response is now recorded
as an error.

Cache key bumped to `ads_v3`, so the first load after deploy is a live fetch
per preset. `refresh-scaling-detection` reads the new prefix.

## 2026-09-17: The new store's Page was invisible, and its videos wouldn't play — uncommitted

Two complaints after NURTELLE was added: ad videos not viewable in Ad
Performance, and NURTELLE missing from the Facebook Page list in Create Ad and
Bulk Create. They look unrelated. They are the same thing seen from two
screens — the connected token cannot reach that Page — plus one real bug that
guaranteed the Page could never appear even once that is fixed.

- **The bug: `/api/facebook/create/pages` only ever asked `/me/accounts`.** The
  Business Manager fallback was written as `if (pages.length === 0)`, so it
  fired only when the token could see *no* Pages at all. With four older Pages
  answering, the fallback never ran — a Page added to the business without
  giving the token's user a Page role was invisible forever, no matter what was
  fixed on Meta's side. It now merges **all three** edges — `/me/accounts`,
  every business's `owned_pages`, and `client_pages` — dedupes by id, and
  records which edge each Page came from.
- **It also paginates now.** The old call took the first 100 and never followed
  `paging.next`, and swallowed edge errors into an empty list. A dead edge no
  longer hides the Pages the others returned; it comes back as a warning
  alongside them.
- **New: Settings → Facebook Ads → Access Check.** One button that answers what
  the token can actually reach: validity, type, expiry, the scopes it holds and
  the ones it is missing (each named with what breaks without it), the
  businesses and ad accounts it sees, and every Page with a **Video OK / No
  video** verdict.
- **That verdict is the real test for the video symptom.** Graph returns
  `source: null` on `/{video_id}` for every token except a Page token, so the
  check asks each Page for `?fields=access_token`. A Page that lists fine but
  cannot mint one shows ads and plays no video — exactly the reported symptom,
  and previously invisible without curling `/api/admin/video-trace` with an ad
  id in hand.
- The findings are written as instructions, not codes: "N Pages cannot produce
  a Page token, so ad videos on them will not play: NURTELLE. Give the token's
  Facebook user a role on those Pages in Business Settings → Pages → Add
  People."
- Client cache key bumped to `v3` — the Page list is cached for 10 minutes in
  `sessionStorage`, so without this an open tab would keep showing the
  pre-fix list with the new Page still missing.
- `src/lib/facebook/pages.ts` holds the merged lookup and the Page-token probe,
  shared by the Create Ad endpoint and the access check so they can never
  disagree about which Pages exist.

**What this does not fix:** if the token's user genuinely has no role on the
NURTELLE Page, the videos still will not play. No code can grant that — it is a
Business Settings change. The Access Check now names it precisely instead of
leaving it to be guessed.

## 2026-09-16: Repeat Buyers counts delivered parcels, not Shopify orders — uncommitted

A Shopify order is not a sale. On COD it is a promise — the money only exists
once J&T hands the parcel over and someone pays. An order that was cancelled,
or shipped and returned to sender, looked identical to a real purchase in the
first cut of this tab, which meant the reseller list could be full of people
who never paid for anything.

- **Delivered is now the default count.** Each Shopify order is joined to its
  J&T parcels by waybill (`fulfillments[].tracking_number` = `jt_deliveries.waybill`,
  the same key `/api/profit/daily` and the pick-pack link already use) and
  resolved to one outcome: delivered, returned, in transit, cancelled, or
  unverified. Only **delivered** feeds orders, units, revenue, AOV, reorder gap
  and the reseller thresholds.
- **Shopify still supplies what J&T does not carry** — phone number, SKU, and
  the SRP actually charged. J&T supplies the truth about whether the purchase
  happened. A split shipment counts as delivered when any box landed; the box
  that came back still shows in the buyer's RTS value.
- **RTS is now a first-class number.** New table column (count + rate, amber at
  20%, red at 35%), a summary card with the peso value sent back, and per-buyer
  `rts_rate_pct` / `rts_value` in the drawer and the CSV. A buyer with 8
  delivered and 6 returned is not the reseller you want, and the list now says
  so instead of showing 14 orders.
- **Every order stays visible in the drawer**, badged by outcome with its
  waybills, the signing time when it landed, and J&T's RTS reason when it
  didn't. Non-delivered orders are marked "not counted" rather than hidden.
- **"All Shopify orders" mode** is one toggle away, for when the J&T upload is
  behind and you need to see the shape anyway. It is explicitly not the mode
  for judging a reseller, and the page says so.
- **Coverage and freshness are stated, not assumed.** A banner reports what
  share of shipped orders have a parcel on file, how many don't, and which day
  the parcel data reaches — turning amber past the same 3-day staleness line
  the Bonus Tracker and the upload panel use. Without it, a week-old upload
  reads as "nobody is buying again".
- Parcels are read as one indexed `submission_date` range scan reaching 7 days
  before the window (pick-pack lag is 1-3 days), drained through `fetchAllRows`
  so PostgREST's 1000-row cap can't silently truncate them. It runs in parallel
  with the Shopify fetch.
- `ShopifyOrder` gained `tracking_numbers` — every waybill on the order, not
  just the first fulfillment's, so split shipments join correctly.
- 19 unit tests now cover the outcome resolution, RTS rates, split shipments,
  coverage math and both count modes.

## 2026-09-16: Repeat Buyers — who is buying again, and who looks like a reseller — uncommitted

Orders & Parcels answers "what shipped today". Nothing answered "who keeps
coming back", which is the question that matters now that resellers are buying
through the same storefronts as consumers.

- **New tab: Orders → Repeat Buyers** (`/admin/repeat-buyers`, admin only —
  customer spend and contact details are CEO data, not floor data).
- **Identity is phone first, then email, then Shopify customer id.** PH COD
  checkouts reuse throwaway emails far more than throwaway numbers, and a
  number normalized to its last 10 digits matches `09171234567`,
  `+63 917 123 4567` and `639171234567` as one person. Placeholder emails
  (`noemail@noemail.com` and friends) are ignored so they can't merge strangers
  into one fake mega-buyer. An order with none of the three groups with
  nothing — it can never be mistaken for a repeat.
- **Grouping crosses stores.** Someone buying I LOVE PATCHES and CAPSULED on
  the same number is one buyer with two brand badges, which is exactly the
  pattern a reseller shows.
- **The table**: orders, units (and units/order), total spent, AOV, average
  reorder gap, first order, last order, and days since last — coloured against
  that buyer's own rhythm, so a reseller who has gone two gaps quiet turns red
  instead of blending in.
- **The drawer**: contact details with copy buttons, latest shipping address,
  discount codes used, a product rollup (quantity, quantity-weighted average
  SRP, revenue), and the full purchase history — every order dated, with each
  line as `qty × SRP = total` and how many days after the previous order it
  came.
- **Reseller candidates** are flagged when a buyer clears any of: 3+ orders in
  the window, 10+ units, or a single order of 5+ units. The badge names which
  signal fired, and a filter shows only those buyers.
- **Cancelled, voided and refunded orders never count** toward orders, units or
  money — they stay visible in the drawer marked as excluded, and as a `+n✕`
  next to the order count, because a reseller whose orders keep getting
  cancelled is its own signal.
- Windows of 30 / 90 / 180 (default) / 365 days, store filter, minimum 2 / 3 /
  5 orders, search across name, phone, email, product and SKU, and a CSV export
  that carries the product mix inline.
- **Shared order plumbing.** `shopifyFetchOrders`, `isDeadOrder`,
  `computeAgeLevel` and a new `toShopifyOrder` normalizer moved out of
  `/api/shopify/orders` into `src/lib/shopify/fetch-orders.ts`, so both screens
  read the same field set and agree on what "dead" and "COD" mean. Side effect
  on Orders & Parcels: an order with no customer record now shows the shipping
  address name instead of "Unknown".
- `ShopifyOrder` gained `customer_id` — the last-resort grouping key.
- **Caps**: 15-minute server cache (the window is months long, one new order
  barely moves it), `maxDuration = 300` because a year across every store is
  dozens of paginated Shopify calls, and at most 500 buyers in the payload
  (biggest spenders first) since each one carries its full order history. The
  summary cards still count every repeat buyer in the window.
- 14 unit tests in `src/lib/shopify/__tests__/repeat-buyers.test.ts` cover phone
  normalization, cross-store matching, cancelled-order exclusion, gap and SRP
  math, and the reseller thresholds.

## 2026-09-15: Bonus Tracker says how current its numbers are — uncommitted

The page quoted parcels-per-day with no way to tell whether the data behind it
was uploaded this morning or last week. Everyone except an admin reads this
page and none of them can see the J&T uploader, so a stretch with nothing
uploaded looked exactly like a slow stretch.

- **`/api/bonus/overview` now returns a `freshness` block**: the newest parcel
  day in `jt_deliveries` (as a PHT calendar day), how many days behind today
  that is, whether that crosses the 3-day staleness line the admin upload panel
  already warns at, and when the newest `jt_upload_batches` row landed. Two
  single-row index reads, folded into the existing `Promise.all`.
- **Measured from the newest parcel, not the last upload.** Uploading a file of
  old rows moves the upload time without moving the numbers forward. The upload
  time is shown alongside it because "nobody uploaded since Monday" and "J&T
  scanned nothing since Monday" are different people's problems.
- **A badge under the page title** reads "Parcel data is current through today,
  Sep 15, 2026 · last upload Sep 15, 2026, 10:05 PM (2 hours ago)", and turns
  amber with a warning icon once the data is more than 3 days behind.
- Cache key bumped to `v3` — the payload shape changed, so entries written by
  the old shape must not be served to a client that now reads the new field.

## 2026-09-15: Video review survives a denied Facebook video — uncommitted

Opening a NURTELLE ad in Submitted Videos showed a bare
`(#10) Application does not have permission for this action` where the player
should be.

- **The error is Facebook's, and it is real**: the token's user has no role on
  the ad account or Page that owns the video, so Graph refuses the video node.
  Nothing in the app can grant that — it's a Business Settings change.
- **But it shouldn't be a dead end.** The modal already had a thumbnail
  fallback for videos whose source won't resolve, with a caption pointing at
  "View on Facebook". It was unreachable: the `error ?` branch came first in
  the render chain and short-circuited it. Now a failed lookup only shows the
  hard error when there is no still to fall back on, and otherwise renders the
  thumbnail with the reason as the caption. The rest of the review screen —
  results, notes, star, the Facebook links — works throughout.
- **`describeFbError`** turns the codes that actually come up into an
  instruction: 10/200/299 name the missing ad-account access, 190 says the
  token expired. Other codes pass through Facebook's own wording as before.

### Dashboard-wide audit for the new store

Swept every store reference outside Marketing. `store-matching.ts` was the
only hardcoded gate in the codebase, and it already has NURTELLE. Everything
else resolves stores at runtime:

- `deriveStore(campaign, storeNames)` takes the list as an argument; both
  callers (AI analytics compare, Creatives) load it from `shopify_stores`
  where `is_active`.
- Call Confirmer boosts `order.store_name` in the transcriber from the order
  itself — the FOLIQ mentions there are pronunciation notes, not a store list.
- Scaling detection joins `store_scaling_campaigns` by `store_name`.
- Pick/pack verify reads `ACTIVE_STORES`, which NURTELLE is now in.
- The store names in the AI tool registry and prompt files are worked examples
  for the model, not filters.


## 2026-09-15: NURTELLE across the Marketing tab — uncommitted

Follow-up to the ad-spend fix: make every Marketing surface work for the new
store. Audited the whole tab rather than patching screen by screen.

**Already store-agnostic — no code changed, and none needed:**
Create Ad and Bulk Create both read their store list from
`/api/marketing/store-defaults`, which selects `shopify_stores` where
`is_active`, so NURTELLE shows up the moment it exists. Same for ad-copy
presets (keyed by `store_id`), scaling (`store_scaling_campaigns` keyed by
`store_name`), winners pool, AI analytics comparisons and creative tagging —
all read `store_name` as data. Fix Rejections gates on `/nurser/i` against the
campaign name, which is brand-independent (and does not accidentally match
"NURTELLE").

**The one real gate was `matchAdToStore`**, whose hardcoded keyword list is
what fills `store_name` in the first place — everything above is downstream of
it. It gained NURTELLE and the ad account fallback in the previous commit, but
only `/api/profit/daily` passed the account name. Its other two call sites
still matched on campaign names alone, so NURTELLE ads would show up
unattributed on those screens:

- **Ad Performance** `marketing/ads/page.tsx` now passes `rowData.account`,
  the ad account name, which the row already carried.
- **Submitted Videos** `/api/marketing/submitted-videos` had only account
  *ids*, so it now fetches `id,name` from `/me/adaccounts` once per request and
  passes the matching name through `toSubmittedAd`. A failed lookup resolves
  to `""`, which degrades to exactly the previous campaign-name behaviour
  rather than erroring.

Existing stores are untouched: campaign-name matching still wins, and the
account name is consulted only when the campaign and adset name no brand.

**Still needs configuring (data, not code):** NURTELLE's store ad defaults
(Page, pixel, URL, CTA, targeting) via the Store picker's "Save current as
store default", and a `store_scaling_campaigns` row if it should appear in
Scaling.


## 2026-09-15: NURTELLE ad spend — attribute by ad account name too — uncommitted

NURTELLE's P&L showed real revenue but ₱0.00 Ad Spend, so CPP read ₱0.00.

- **Cause** `matchAdToStore` matched a hardcoded keyword list —
  I LOVE PATCHES / CAPSULED / FOLIQ — against the **campaign and adset names**
  only. NURTELLE was never in the list, so every peso it spent fell to
  `UNATTRIBUTED`.
- **Account-name fallback** NURTELLE's ads live in an ad account named for the
  brand, while the campaigns inside it aren't necessarily. `matchAdToStore`
  now takes an optional third argument, the ad account name, and falls back to
  it when the campaign and adset name no brand. `/api/profit/daily` asks Meta
  for `account_name` alongside the existing insight fields to supply it.
  Campaign naming still wins, so one account running two brands attributes
  each campaign to the brand it actually advertises, and retired brands are
  still ignored in the account name just as in the campaign name.
- NURTELLE joins `ACTIVE_STORES` (store pickers) and `matchSenderToStore`
  (J&T sender normalizing), the way the other live brands are registered.
- 3 new tests: account-name fallback, campaign-beats-account precedence, and
  retired brands staying unattributed via the account name.

**Note:** attribution only runs over ad accounts ticked in Settings →
Facebook. If NURTELLE's account isn't selected there, no insights are fetched
for it at all and this change can't help.


## 2026-09-15: The live URL is astrobiz.live, not the vercel.app name — uncommitted

`astrobiz-dashboard.vercel.app` appeared in PROJECT_CONTEXT as the live URL and
in TODO as the value for `NEXT_PUBLIC_APP_URL`, and it is dead — it answers 404
with `x-vercel-error: DEPLOYMENT_NOT_FOUND`. The real origin is
**https://astrobiz.live**.

This cost a full debugging round on the Shopify connect: the dead name was
whitelisted in the app's Allowed redirection URLs while the deployment was
sending its real origin, so Shopify kept answering
`Oauth error invalid_request: The redirect_uri is not whitelisted` — correctly.
Probing the public callback route settled it, since it redirects to
`${appUrl}/admin/settings` and so prints the resolved origin in its Location
header:

    $ curl -sI https://astrobiz.live/api/shopify/auth/callback
    location: https://astrobiz.live/admin/settings?shopify_error=Missing+code...

That also confirms `resolvePublicAppUrl` resolves correctly in production.
Every reference now says astrobiz.live, and PROJECT_CONTEXT records that the
old name is dead so it doesn't get copied back out of git history.


## 2026-09-14: Shopify store connect — connect by access token, no app config — uncommitted

Connecting a new store died on Shopify's `Oauth error invalid_request: The
redirect_uri and application url must have matching hosts`. Two causes, and a
third path added so the failure mode stops existing.

- **Host-less redirect_uri** `src/app/api/shopify/auth/route.ts` built the
  `redirect_uri` from `NEXT_PUBLIC_APP_URL || request.headers.get("origin")`.
  The connect button navigates with `window.location.href`, and browsers do
  not send an `Origin` header on a top-level GET, so whenever
  `NEXT_PUBLIC_APP_URL` is unset the fallback is `null` and the `redirect_uri`
  collapses to the host-less `/api/shopify/auth/callback`. Shopify then has no
  host to match the app's App URL against.
  Fixed by `src/lib/app-url.ts` — `resolvePublicAppUrl(request)`, the same
  resolution order the briefings already relied on: `NEXT_PUBLIC_APP_URL`,
  then Vercel's own `VERCEL_PROJECT_PRODUCTION_URL`, then the request host.
  Step 2 means the redirect is right on Vercel with no env var set at all.
  `resolveBriefingBaseUrl` delegates to it instead of duplicating the logic.
- **The app's own App URL** is the other half, and no amount of app code can
  set it — a freshly created app in the Shopify Dev Dashboard carries a
  placeholder App URL that will never match this host.
- **So: connect by Admin API access token instead.** The store form now leads
  with an "Access token" method — paste the `shpat_…` token from
  Settings → Apps and sales channels → Develop apps → API credentials and the
  store is connected, no App URL, no redirect URL, no client secret. OAuth
  only ever existed to go and fetch one of these tokens, and every Shopify
  read in the codebase already authenticates with `api_token`. OAuth is kept
  as the second tab for apps already wired up.
  `src/lib/shopify/verify-token.ts` tests the token against `shop.json`
  **before** the insert, so a bad paste is rejected at the form instead of
  turning into an empty orders table hours later.
- **Correction to the above:** Shopify has retired admin-created custom apps
  ("You can no longer create new admin-created custom apps"), so the access
  token path only covers stores set up before that. Apps made in the Dev
  Dashboard have no `shpat_` token to copy and must use OAuth — their App URL
  and redirect URL live under **Versions → Create a version**, not App
  settings. The token tab's help text says so rather than sending people to a
  dead end.
- **Store URL normalizing** `src/lib/shopify/store-url.ts` — the field is
  filled by copying from a browser, so it arrived as
  `admin.shopify.com/store/<handle>`, a legacy admin URL with a path, a bare
  handle, or with a scheme and trailing slash; each silently produced a broken
  API host. Now folded down to `<handle>.myshopify.com` on save. 9 unit tests.

## 2026-09-02: Bonus Tracker — parcel-volume bonus dashboard — uncommitted

New main tab visible to **every role** (`/bonus`). Shows the team what
they are working toward: the company-wide parcel bonus, judged on the
average parcels/day across the semi-monthly cutoff period (1st–15th,
16th–EOM), plus the health metrics the CEO wanted alongside it.

- **Migration** `supabase/bonus-tiers-migration.sql` — **NOT yet applied
  to prod, run it in the Supabase SQL Editor**:
  - `bonus_tiers` (parcel_threshold, bonus_amount, label, is_active),
    unique on threshold. Seeded thresholds 70/100/130 with **no payout
    amounts** — `bonus_amount` is nullable and left unset until the CEO
    announces the figures. Idempotent, and ends with
    `notify pgrst, 'reload schema'` so PostgREST stops answering
    "Could not find the table 'public.bonus_tiers' in the schema cache".
  - RLS: **read for every signed-in employee**, write admin-only.
- **Period model** `src/lib/bonus/period.ts` — pure PHT date math for
  semi-monthly cutoffs. Handles 31-day months (16-day second half),
  February (13-day), and year-boundary rollback. 20 unit tests.
- **Tier math** `src/lib/bonus/tiers.ts` — highest tier cleared, plus
  the gap to the next one as a **daily pace** ("12 more parcels/day").
  A rolling window has no deadline to bank parcels against, so a
  countdown of parcels would be measuring against a period the headline
  number is not scoped to.
- **Headline average is the rolling last 15 days** while the cutoff is
  still open, switching to the cutoff period's own average on the 15th /
  end-of-month. On day 2 of a period the cutoff-to-date average is two
  days of noise; a 15-day window is always a full sample. The cutoff
  figure stays visible underneath, and is labelled as the one the bonus
  actually settles on. The pace count is sliced out of the rows already
  fetched for RTS, so it costs no extra query.
- **All Bonus Tracker copy is English** — the tab shipped in Taglish.
- **`GET /api/bonus/overview`** — any signed-in role. Authenticates the
  session first, then reads `jt_deliveries` with the service client
  (that table is admin-only under RLS) and returns **aggregates only**,
  never per-waybill rows. 5-min cache via `cached_api_data`.
  - Parcels: J&T rows by `submission_date`, PHT day boundaries, all
    stores.
  - **Average CPP (15d)**: read from `/api/profit/daily` over
    Bearer CRON_SECRET so the number matches Net Profit exactly rather
    than being a second definition. Weighted (total spend ÷ total
    orders), not a mean of daily CPPs — a zero-order day would skew it.
  - **RTS (30d)**: returned ÷ settled (delivered + returned). Parcels
    still in transit are excluded from the denominator, otherwise a
    busy shipping week fakes an improving RTS rate.
- **`GET/PUT /api/bonus/tiers`** — GET for all roles, PUT admin-only.
  PUT replaces the whole ladder (delete-then-insert) since the editor
  owns the full list and removing a tier has to actually remove it.
- **UI** `src/components/bonus/` — hero card (running average, tier
  held, progress bar, "kailangan pa ng N parcels = M/day"), 4 metric
  cards (CPP / parcels / RTS / days left), tier ladder, daily-parcel
  bar chart with tier guide lines, previous-cutoff recap, and an
  admin-only inline tier editor.
- **Decisions locked from planning round**:
  - One company-wide tier, **same payout for every employee** — the
    amounts are not announced yet, so the tracker shows markers only
  - Tier judged on the **cutoff-period average** (every 15th + EOM)
  - CPP and RTS are **display-only for now** — not gates on the bonus
  - Visible to **all roles**
- **Known follow-ups**: payout amounts are not set — when they are,
  fill `bonus_amount` and surface it in the ladder/hero again; CPP/RTS gates
  are not implemented; there is no per-period payout ledger yet (the
  page reads live, it does not archive a closed period's result).

## 2026-05-11: VA Dialer foundation (Phase 2, Day 1) — uncommitted

Server-side scaffolding for the upcoming browser softphone. No UI yet —
the actual dialer + VA queue ship in Day 3-4. Twilio console setup is
manual one-time (TwiML App + API Key) and pending user action.

- **Migration** `supabase/va-dialer-migration.sql` (idempotent, applied
  to prod Supabase):
  - `va_dialer_config` (singleton id='default') — admin-editable budget
    + recording retention. Seeded with **$15/day cap, 60-day retention,
    enabled=true**.
  - `va_call_spend_daily` — per-day rollup of VA call cost. Separate
    pool from AI Call Confirmer's `call_spend_daily` (which is
    per-store) so the team-wide $15 budget tracks cleanly.
  - `call_attempts` extended with `locked_by` + `locked_until` for
    optimistic queue-row locking ("Take Call" button reserves a row
    for 30s before another VA can grab it).
  - Helpers: `va_dialer_has_budget()`, `va_queue_claim()`,
    `increment_va_call_spend()` (security definer; webhook calls them).
  - RLS: admin all-access on both new tables; VA can read config only.
- **Token endpoint** `POST /api/twilio/voice-token` — mints a 1hr
  Twilio Voice access token for the browser SDK. Refuses with 429 if
  today's spend hit the cap. Identity = `va-{employee.id}`.
- **NPM packages** added: `twilio` (server, token signing) +
  `@twilio/voice-sdk` (browser).
- **Pending user setup**:
  - Twilio TwiML App "Astrobiz VA Dialer" with Voice Request URL
    `/api/twilio/voice-twiml` and Status Callback URL
    `/api/twilio/voice-status` (POST both).
  - Vercel env vars: `TWILIO_API_KEY`, `TWILIO_API_SECRET`,
    `TWILIO_VA_APP_SID`.
- **Decisions locked from planning round**:
  - Browser softphone (headset, no physical phone)
  - Shared queue (not per-VA assignment)
  - Manual dial allowed (call any number outside queue)
  - Recording auto-delete after 60 days
  - $15/day VA-only cap (separate from $5/day AI cap = $20/day total max)
  - Recording disclosure played before connecting (PH legal compliance)

## 2026-05-08: Admin KPI Dashboard — traffic-light tiles + manual entry forms

CEO-only `/admin/kpi-dashboard` showing weekly accountability metrics
across Marketing, Sales/VA, and Fulfillment. Locked thresholds (red /
yellow / green) editable in `kpi_targets`. Snapshots computed nightly
at 23:55 PHT via cron, drilldown sidebar shows raw breakdown.

- **Migration** `supabase/kpi-dashboard-migration.sql`:
  - `kpi_targets` (seeded with 11 KPIs across 4 segments — marketing,
    sales_va, fulfillment, watch)
  - `kpi_daily_snapshots` (one row per kpi/scope/employee/day; unique
    index uses `nulls not distinct` so team-scope rows upsert cleanly)
  - `packing_errors` — fulfillment lead's EOD QA log; distinct from
    pack_verifications (which captures in-process scan mismatches)
  - `stock_counts` + `stock_count_watchlist` — Sunday physical count
    form, top-N SKUs admin-managed
  - `fb_ad_attribution` — maps an FB ad to the marketer who created
    it (FB API created_by isn't reliable when Business Manager user
    is shared)
  - `call_attempts` extended with `va_id` + `call_source` (`ai` |
    `va_browser` | `manual_log`); outcome enum extended with
    `no_answer` and `cancelled`
- **KPIs wired (live):**
  - 🎯 RTS rate 14d (CEO watch) — first measurement showed **13.8%
    (green)**
  - VA confirmation rate, calls/day, time-to-first-call, save rate,
    queue cleared (zero now; will populate when Phase 2 dialer ships)
  - Perfect pack rate (joins pack_verifications × jt_deliveries ×
    packing_errors × call_attempts confirmation timestamp)
  - Stock variance (waits on Sunday counts)
  - Creatives tested / week (waits on marketing tagging)
- **KPIs deferred (clearly TODO'd in `lib/kpi/compute.ts`)**: FB
  winners detection (needs daily insights cache), blended ROAS (needs
  FB Insights API integration). Time-to-first-call uses queue dwell
  proxy until Shopify order timestamps cached locally.
- **Cron** `/api/cron/compute-kpis` — runs `55 15 * * *` (23:55 PHT).
  Admin can also trigger on-demand via `POST /api/kpi/recompute` (the
  "Recompute now" button on the dashboard).
- **UI**:
  - `/admin/kpi-dashboard` — 11 traffic-light tiles grouped by
    segment, summary counter, drilldown side panel
  - `/marketing/creative-tagging` — marketers claim FB ad IDs (counts
    toward "creatives tested / week")
  - `/fulfillment/stock-count` — Sunday count form, pre-fills expected
    qty from `inventory_snapshots`
  - `/fulfillment/packing-errors` — fulfillment lead's EOD log; logs
    7 error types incl. `late_ship` so perfect-pack folds in <24h SLA
  - Sidebar nav added for all 4 routes
- **Conventions**: read-only dashboard reads from `kpi_daily_snapshots`
  only (cron writes; never recomputes on page load). All queries use
  `fetchAllRows()` to avoid the silent 1000-row PostgREST cap.

## 2026-04-20: Scaling-campaign promote action (Phase B)

Actually copies a testing ad into the store's scaling campaign.
Per-ad, one click, review-first by default.

- **New endpoint** `POST /api/marketing/scaling/promote` wraps
  Meta's `POST /{ad_id}/copies`. Safety check before firing:
  verifies the target adset is actually inside the store's
  configured scaling campaign so a malformed request can't drop
  the ad anywhere arbitrary. Logs every promote with employee id,
  source ad, target adset, and resulting copied_ad_id.
- **PromoteToScalingModal** — pick store (auto-derived from the
  ad's campaign name), pick adset (live from FB), choose status
  option (PAUSED default for review, ACTIVE for fast-path).
  Surfaces FB error codes + human-readable messages on failure.
- **Promote button on Ad Performance** — appears beside View /
  Analyze on ad-level rows, hidden when the ad is already scaled
  or is itself inside a scaling campaign. Toast + refetch on
  success so the ↑ SCALED chip updates.
- **Promote button on Creative Deconstruction** — next to the
  Analyze / Re-run buttons in the selection action bar, same
  guard rules.

## 2026-04-20: Scaling-campaign detection (Phase A)

Links testing-campaign ads to their "already in scaling" status so
you can tell at a glance which creatives have already been promoted.

- **Per-store scaling mapping**. New `store_scaling_campaigns`
  table; admin picks one FB campaign per Shopify store in
  Admin → Settings → Scaling Campaigns. Dropdown lists all
  active + paused campaigns across your ad accounts.
- **Creative-ID match**. `POST /api/marketing/scaling/detect`
  takes ad_ids, resolves each creative_id via a batch Graph call,
  and compares against creative_ids live in every configured
  scaling campaign. Server-side 5-minute cache per scaling
  campaign so detection doesn't re-walk Graph on every view.
- **Badges**:
  - **Ad Performance** (ad-level drill) — orange "↑ SCALED" chip
    beside the status badge; "↑ SCALING" if the row itself is
    inside a scaling campaign.
  - **Creative Deconstruction** cards — same badge, rendered on
    the thumbnail next to "✓ Analyzed".
- **Prep for Phase B**. New endpoints scaffolded for the upcoming
  "promote to scaling" action: GET/PUT/DELETE
  `/api/marketing/scaling/config`, `GET
  /api/marketing/scaling/adsets?store=X`, `GET
  /api/marketing/scaling/campaigns-available`.
- Migration: `supabase/scaling-campaigns-migration.sql`
  (idempotent). Admin-only writes, marketing read-only.

## 2026-04-19: Attendance improvements — shifts + reminders + auto-close

Added the supervisor-style attendance system to fix forgotten clock-ins,
breaks, and clock-outs:

- **Per-day shifts** — new `employee_shifts` table. Schedules vary
  week-to-week, so the editor at `/admin/attendance/schedule` is a 7-day
  grid (rows = employees, cols = Mon-Sun). Click a cell → set start/end
  + break, or mark Day Off. "Copy last week" pulls a template forward.
- **Attendance-check cron** every 15 min (`/api/cron/attendance-check`):
  - Clock-in reminder if 15+ min past shift start with no entry
  - Break reminder if running > 4h continuous (no pauses)
  - Clock-out reminder if 15+ min past shift end and still running
  - **Auto-close** any session running ≥ 10h (prevents inflated hours
    when someone forgets to stop the timer overnight). Logs to
    `attendance_events`, alerts admin, notifies the employee.
- **Admin Attendance Issues panel** at `/admin/attendance` — live view
  of: not clocked in, long-running sessions, missed clock-outs,
  auto-closed yesterday. Refreshes every minute.
- **Persistent clock-in status banner** on every page (all roles).
  Green/yellow/red indicator with elapsed time and "Clock in now" CTA
  when a shift is active.
- **Employee notifications** — new `employee_notifications` table +
  bell + inbox for non-admin users. Dedup window per type prevents
  spam. RLS scoped so employees only see their own.

Email templates render via Resend; in testing mode only the Resend
signup email receives. Other employees still get in-app notifications.

## 2026-04-19: Scheduled briefings — morning / evening / weekly / monthly

Added a scheduled-digest layer on top of the alerts system:

- **4 cron schedules** (PHT): morning 6 AM, evening 10 PM, weekly Mon
  9 AM, monthly 1st 9 AM. Each generates a full briefing.
- **Data collected per period**: P&L (with vs prior period delta),
  orders/unfulfilled/aging, top 5 products by revenue, top 3 ads + 3
  ads to review, store breakdown, autopilot activity, RTS, stock
  movement, team hours.
- **AI summary** — Claude Sonnet 4.6 writes a 2-5 paragraph narrative
  per briefing using the `anthropic_api_key` from `app_settings`.
  Briefing-specific prompts (morning = action-oriented, monthly =
  strategic). Summary appears at the top of email + in-app detail view.
- **Email template** — rich HTML with metric tables, top lists, and
  CTA to view full report in-app.
- **In-app browsing** — `/admin/briefings` list (filterable by type)
  + `/admin/briefings/[id]` detail page with full data.
- **Idempotent**: re-running a cron for the same (type, period) is a
  no-op.

## 2026-04-19: Cron RLS fix — internal API calls were silently empty

Fixed a structural bug affecting all crons that fetched data through
internal routes:

- Cron Bearer auth bypass let requests reach the route handler, **but**
  the routes used `createClient()` (user-session client) for the
  Supabase queries. With no session, RLS on `shopify_stores` and
  `app_settings` returned empty → revenue/orders/ads all came back as
  zero. The morning briefing's "₱0 revenue" was caused by this.
- Patched `/api/profit/daily`, `/api/facebook/all-ads`, `/api/shopify/
  orders` to use `createServiceClient()` when `isCron === true`.
  Added the cron bypass to `/api/shopify/orders` which was missing it.
- Also fixes silently-broken `refresh-data` pre-warming of the cache.

## 2026-04-19: store_outage rule — fix false positives

The `store_outage` alert rule was probing each store via our own
`/api/shopify/orders` endpoint. That route requires a user session,
so cron invocations always got 401 → every store flagged "failing"
on every run. Fix: probe Shopify directly via
`/admin/api/2024-01/shop.json` with the stored access token, skipping
our routing layer entirely.

## 2026-04-19: Middleware — exempt cron + Bearer-secret bypass

Two bugs surfaced when wiring the new alert/briefing crons:

- Public-routes list didn't include `/api/cron/`, so middleware was
  redirecting every cron invocation (including Vercel scheduler hits)
  to `/login`. All existing crons were silently being intercepted.
- Internal cron-to-cron fetches with `Authorization: Bearer
  CRON_SECRET` also got redirected since middleware checked Supabase
  session, not the Bearer. Added a top-of-middleware short-circuit:
  any request whose Authorization header matches `Bearer
  ${CRON_SECRET}` skips the session check entirely.

## 2026-04-19: Admin notifications system

Decision-support layer for the CEO. Detects events worth surfacing
(stock restocks, depleting winners, new winners, autopilot actions,
RTS spikes, cash at risk, store outages) and pushes them via:

- In-app **bell icon** with unread badge (admin only)
- **/admin/notifications** inbox with Unread/Acted/Dismissed/All tabs
  + severity-grouped sections + Mark all read
- **"Today's Decisions"** action feed at the top of `/dashboard`
- **Email** to admins via Resend — urgent severity emails immediately
  after detection, action/info severity rolled into a daily digest
  cron at 9 AM PHT

Schemas: `admin_alerts` table with severity / dedup / lifecycle
(read/dismissed/acted) + `inventory_snapshots` table populated daily
to power stock rules. Rule engine cron runs every 30 min and dedups
per (type, resource_id) within a configurable window per rule.

Recipients controlled by `ALERT_RECIPIENTS` env var (comma-separated)
to keep emails inside Resend's testing-mode allowlist until a verified
domain is added.

## 2026-04-19: Team-specific dashboard layouts

Replaced placeholder team dashboards with role-specific views:

- **Admin** — adds `AlertsFeed` hero section, then existing P&L + ops
  cards. Cockpit feel.
- **Marketing** — Action Queue (scaling winners / fading / dead
  weight from 7-day FB data) + Autopilot 24h activity log.
- **VA** — By Store breakdown card with total / unfulfilled / aging
  per store, click-through to filtered orders.
- **Fulfillment** — Pack Queue CTA card (orders ready to verify),
  My Verified Today counter, SKUs Running Out Soon list driven by
  inventory_snapshots velocity.

## 2026-04-19: AI Analytics — video resolution fixes + CPP on cards

Iterated on the Creative Deconstruction picker after the first pass
surfaced real-world failures:

- **Cost Per Purchase (CPP) badge** on every card (fourth metric
  after purchases / ROAS / spend). Shows "—" when an ad has 0
  purchases so we don't display a fake CPP. New sort option
  "CPP (low → high)" that puts zero-conversion ads at the bottom
  so the top of the list is always ads that actually sold.
- **Video resolver: expanded creative paths.** Most Ads-Manager
  ads store their video under
  `creative.object_story_spec.video_data.video_id` — that path
  wasn't being checked, so almost every Capsuled ad failed with
  "No playable video on this ad." The resolver now walks six
  paths in likelihood order: direct `creative.video_id`,
  `object_story_spec.video_data`, `object_story_spec.link_data`,
  carousel `child_attachments`, DCO `asset_feed_spec.videos`, and
  finally the object-story attachments walk. Error messages now
  list every path that was attempted so the next failure is
  diagnosable.
- **Video source fallbacks for dark posts.** Even when the
  `video_id` resolves, direct `/{video_id}?fields=source` returns
  null on dark posts when the token lacks page-level access.
  Added two fallbacks: (1) request `muted_video_url` on the same
  call — fine for Gemini, it's the same visual content;
  (2) query the ad account's `/advideos` edge with an id filter,
  which runs under ad-account permissions and is usually broader.
  Errors now explain the probable cause (token scope) when all
  paths fail, instead of a generic "no video" message.

## 2026-04-19: AI Analytics — real thumbnails, store from campaign, FB link

Three UX fixes to the Deconstruction picker:

- **Thumbnails** now actually render. The `/all-ads` endpoint strips
  creatives for speed, so the picker was showing video-icon
  placeholders for everything. The analytics page now lazy-loads
  the top 60 ads' creatives after the initial fetch (same pattern as
  the Ad Performance page at drill-level ad).
- **Store filter** is now derived from the campaign name instead of
  the ad account. A Meta ad account often runs multiple Shopify
  stores, so "Account" was the wrong unit. The filter now matches
  each campaign name against the Shopify store list (normalized —
  strips spaces/punctuation, lowercases — so "I Love Patches",
  "ilovepatches", and "I-Love-Patches" all map to the same store).
  Longest match wins; unmatched campaigns group under "Unmatched".
  Counts per store shown in the dropdown, "Unmatched" sinks to
  bottom.
- **FB preview link** on each card — small external-link icon top
  right of the thumbnail. Opens the ad's FB post in a new tab so
  you can watch the video before deciding to run Gemini on it.
  stopPropagation keeps card-select behavior intact.
- New endpoint `GET /api/shopify/stores/names` — marketing-safe,
  returns only `{ names: [...] }` for active stores (no api_token
  exposure), uses the service client to sidestep the strict RLS on
  the stores table.

## 2026-04-19: AI Analytics — visual ad picker

Replaces the long single-line dropdown in the Deconstruction tab
with a scannable card grid. The old UI buried ~100 ads in a
crammed select; hard to read, hard to decide.

- **Card grid** with thumbnail + ad name + three colour-coded
  metric badges (purchases, ROAS, spend). ROAS colour: green ≥1.5,
  yellow ≥0.8, red below. Analyzed ads get a green "✓ Analyzed"
  badge so re-picks are obvious.
- **Controls**: store filter, sort (default: purchases desc — matches
  how the operator actually picks winners), "hide already analyzed"
  toggle, search by ad/campaign/adset name.
- **Selection + action bar**: clicking a card highlights it (blue
  ring) and populates a persistent action bar at the top with
  "Analyze" / "View analysis" (if cached) / "Re-run" buttons.
- **Pagination**: 12 cards initially, "Show more" adds 12 per click.
- **Historical strip**: smaller thumbnail row beneath for analyses
  done on ads outside the current date range, so past winners stay
  reachable without switching filters.

## 2026-04-19: AI Analytics — large video support + chat history

- **Gemini File API** for videos >18MB. Ads up to 400MB now work
  (previously failed with "video too large"). Flow: download to server →
  resumable upload to Gemini File API → poll until ACTIVE → reference
  `fileUri` in generateContent. Best-effort delete after analysis;
  Gemini auto-purges after 48h regardless.
- **Per-ad `deconstruct` maxDuration** bumped from 60s to 300s — a 200MB
  video can take ~2-3 minutes end-to-end (download + upload + processing
  + analysis) and was timing out at 60s.
- **Daily cron cap** lowered from 10 to 4 analyses per run so one slow
  video can't push the 300s budget over.
- **Chat history** — each AI Analytics chat now auto-saves per employee
  after every assistant reply. Toolbar shows "History (N)" with a
  dropdown of the 20 most recent chats (title derived from first user
  message, with relative timestamps). Click to resume; trash icon to
  delete. "New chat" button to start fresh.
- Migration: `supabase/ai-chat-sessions-migration.sql` (idempotent).
  Creates `ai_chat_sessions` table with per-employee RLS (each user
  sees only their own chats; admin can see all).
- Extracted chat UI into `components/marketing/chat-panel.tsx` — the
  ai-analytics page is now a thin shell over Chat + Deconstruction panels.

## 2026-04-19: AI Analytics — Phase 2 (Creative Deconstruction)

- **On-demand video deconstruction** — from the ads table, click ✨ Analyze
  on any ad row to open AI Analytics → Deconstruction tab with that ad
  pre-selected. Pulls the ad's video via Facebook Graph, sends it to
  Gemini 2.5 Pro with a response schema, and renders a structured
  breakdown: hook (0:00-0:03), scene/b-roll timeline, visual style,
  tone, CTA, language, full transcript.
- **Deconstruction panel** — new tab in `/marketing/ai-analytics`:
  * Dropdown of currently-loaded ads with ✓ marker for already-analyzed ones
  * Thumbnail grid of past analyses, searchable by ad/campaign/tone/style
  * Click card → modal with the full structured breakdown
  * Re-run button (force refresh) on any analysis
- **Daily auto-run** — Vercel cron `/api/cron/deconstruct-top-ads` at
  09:30 PHT picks the top 2 ads per ad account by purchases (last 7
  days), filters out low-signal ads (min ₱500 spend, ≥1 purchase),
  and caps total work at 10 analyses per run to bound cost. Skips ads
  already analyzed in the last 7 days. Marked as `trigger_source =
  'auto_daily'` in the UI.
- **Cache strategy** — `ad_creative_analyses` keyed by `ad_id`. Fresh
  analyses served from cache for 7 days; older than that auto-refreshes.
  Video source URLs are not persisted (they expire) — only thumbnail URL.
- **Size guardrails** — videos >18MB skip inline analysis with an
  explicit error (Gemini's inline limit is 20MB). Dark posts that don't
  expose a video source URL return a clear "no playable video" message.
- New libs: `src/lib/facebook/video.ts` (walks creative →
  asset_feed_spec → object story → /video source), `src/lib/gemini/deconstruct.ts`
  (inline base64 + responseSchema JSON mode).
- Routes: `POST /api/marketing/ai-analytics/deconstruct` (60s max),
  `GET /api/marketing/ai-analytics/deconstructions`,
  `GET /api/cron/deconstruct-top-ads` (300s max).

## 2026-04-19: AI Analytics — Phase 1 (Chat Insights)

- **New page**: `/marketing/ai-analytics` — chat interface for querying ads
  performance data in natural language (Taglish-friendly). Uses Claude Sonnet
  4.6 with streaming SSE responses.
- Pre-loads ads snapshot from the existing `/api/facebook/all-ads` endpoint
  (respects date preset + account filter) and feeds a compact TSV of the
  top 50 ads by spend into the system prompt along with account totals.
- Sample prompts pinned: "Top 3 ads based on ROAS?", "Which ads are bleeding
  money?", "Compare top vs bottom ad", "Account health summary".
- Sidebar link added under Marketing → Analytics (admin + marketing roles).
- **Gemini API key** management added to Admin → Settings (Phase 2 will use
  it for video creative deconstruction; key field lives here now so it's
  ready when that ships).
- Generalised `AiKeyManager` component to support any `settingKey` with
  title/label/placeholder/docs props + blue/purple/emerald accents.
- Migration: `supabase/ai-analytics-migration.sql`
  - `ad_creative_analyses` table scaffolded (Phase 2 storage for video deconstructions).
  - `app_settings` RLS updated so marketing role can read
    `anthropic_api_key` and `gemini_api_key` in addition to
    `fb_access_token` / `fb_selected_accounts`.
- Route: `POST /api/marketing/ai-analytics/chat` (SSE streaming, 60s max).

## 2026-04-19: Manual Clear for Pick & Pack Queue

- **Mark as Already Packed** button on `/fulfillment/pick-pack` — lets admin &
  fulfillment roles remove selected orders from the queue without running a
  scan. Intended for catching up on backlogs where packing happened offline
  or before the system existed.
- Confirmation modal requires a **reason code** (`catching_up_backlog`,
  `already_packed_offline`, `system_error_manual_fulfill`, or `other` with
  a note) and shows the operator's name as attribution.
- Writes `pack_verifications` rows with `source = 'manual_clear'` so they
  are clearly distinguishable from real scan verifications. Preserves
  `verified_by`, `notes`, and timestamps for full audit.
- **Audit page** (`/fulfillment/pick-pack/audit`) Verifications tab rebuilt:
  source filter, store/employee name enrichment, notes column, and a
  per-row **Undo** action that only works on `manual_clear` rows
  (scan rows are immutable from the UI).
- New routes: `POST /api/shopify/fulfillment/manual-clear`,
  `POST /api/shopify/fulfillment/manual-clear/undo`,
  `GET /api/shopify/fulfillment/verifications`, `GET /api/me`.
- Migration: `supabase/pack-verifications-manual-clear-migration.sql`
  (idempotent; adds `notes`, `source`, unique constraint, and source index).

## 2026-04-15: Pick-Pack-Verify Fulfillment Module

### Pick & Pack System
- **Pick & Pack** (`/fulfillment/pick-pack`) — orders queue showing fulfilled orders with waybills that haven't been packed yet
  - Stock availability check per order: ✅ In Stock, ❌ OOS, ⚠ Low
  - Store filter dropdown
  - Bulk select → Generate Pick List
  - Orders disappear from queue after pack verification
- **Pick List** (`/fulfillment/pick-pack/pick-list`) — consolidated pick list
  - Groups items by SKU across multiple orders
  - Scan-to-pick with progress tracking
  - Bin location display (from bin_locations table)
  - Print-friendly layout
- **Verify & Fulfill** (`/fulfillment/pick-pack/verify`) — pack verification
  - Scan waybill → shows order items
  - Scan each item → green/red full-screen feedback with audio
  - Wrong item = BIG RED screen + error buzz
  - Cannot confirm until 100% items matched
  - Logs to pack_verifications table (no double-fulfill — BigSeller handles Shopify fulfillment)
- **Barcodes** (`/fulfillment/pick-pack/barcodes`) — Code 128 barcode label generator
  - Select products → generate labels → print
  - Label sizes: 40x30mm, 50x25mm, 50x30mm
- **Stock Management** (`/fulfillment/pick-pack/stock`) — 4 tabs
  - Stock Overview: product table with stock badges, search, store filter
  - Stock In: scanner-based rapid entry (scan → qty → Enter → next)
  - Adjust: set or adjust stock with required reason
  - Cycle Count: zone-based counting with expected vs actual
- **Bin Locations** (`/fulfillment/pick-pack/bins`) — shelf location CRUD
- **Audit Trail** (`/fulfillment/pick-pack/audit`) — adjustment + verification history

### Fulfillment Workflow
```
VA confirms in BigSeller → waybill printed → auto-fulfills in Shopify
→ appears in Pick & Pack → Generate Pick List → pick items
→ Verify & Pack → scan waybill → scan items → Confirm Packed
→ disappears from queue → ship
```

### Database Tables
- `bin_locations` — product shelf locations
- `inventory_adjustments` — stock change audit log
- `cycle_counts` — cycle count session history
- `stock_alert_thresholds` — low stock alert thresholds
- `pack_verifications` — pack verification log

### New Dependencies
- `jsbarcode` — Code 128 barcode generation

---

## 2026-04-14: Performance + P&L Improvements

### Performance Optimization
- Global client-side cache with sessionStorage persistence (survives page refresh)
- Background refresh every 10 min for Shopify endpoints
- Facebook structure cache (30 min) — campaigns/adsets/ads cached separately from insights
- Pre-fetch prevention: empty/rate-limited responses not cached
- Date preset buttons disabled while loading (prevents rapid API calls)
- "Last refreshed: Xm ago" indicators on Dashboard + Ad Performance
- All Facebook-related fetches across the app use cachedFetch

### P&L Fixes
- Store filter fixed (was sending ID instead of name)
- All store names normalized to uppercase (prevents case mismatch)
- Returns = SRP + shipping cost per returned parcel (not just SRP or just shipping)
- Shipping always projected at 12% of revenue with yellow indicator
- Missing COGS auto-added when clicking "Manage COGS" link
- Removed PROJECTED/ACTUAL labels from Returns (all actual data now)

### Ad Performance
- Added Cost per Landing Page View (Cost/LPV) column

---

## 2026-04-13: AI Generator + Team Management

### AI Ad Generator
- **AI Generator** (`/marketing/ai-generator`) — full chat interface with Claude API
  - Per-store knowledge (6 docs + 3 system instructions per store)
  - Tool selector: Angle Generator | Script Creator | Format Expansion
  - Each tool uses its own system instruction
  - Auto-save threads after each AI response
  - Shared history across team (admin + marketing)
  - Navigation-safe (module-level cache)
- **AI Knowledge** (`/marketing/ai-settings`) — per-store document management
  - 6 knowledge docs: Market Sophistication, New Information, New Mechanism, Avatar Training, Market Research, Winning Ad Template
  - 3 system instructions: one per tool
  - Paste text or upload .txt files

### Team Management (Settings)
- Add/edit/remove employees with role assignment
- Pre-register by email — auto-links on first Google sign-in
- Role legend: Admin (full access), VA (orders), Fulfillment (inventory + orders), Marketing (ads)
- Toggle active/inactive, delete employees

### Sidebar Reorganization
- Collapsible groups: Time & Attendance, P&L, Orders, Fulfillment, Marketing
- Section headers within Marketing: Ad Management, Creative Generator
- Fixed overlapping active states in sidebar

---

## 2026-04-11: Shopify OAuth + Orders & Parcels

### Shopify OAuth Integration
- Replaced manual token input with OAuth flow (Client ID + Secret → Connect → approve)
- Multi-store support (4+ stores) via OAuth per store
- Store management in Settings (add/edit/remove/toggle active)

### Orders & Parcels
- Orders page across all Shopify stores with date/store/status filters
- Order detail slide-out panel (customer, items, tracking, totals)
- Age tracking: 3+ days yellow, 5+ days red
- COD detection, revenue hidden from non-admin

### Inventory Dashboard
- Stock levels across all stores, color-coded badges
- Product detail panel with variants, SKU, barcode
- Price column admin-only

---

## 2026-04-10: Net Profit + J&T Dashboard

### Net Profit / Daily P&L (CEO Only)
- Net Profit = Revenue - COGS - Ad Spend - Shipping - Returns
- Daily P&L table with totals row
- 25% worst-case RTS rule until 200+ delivered
- COGS management (CSV/XLSX import, inline edit, scan from Shopify)
- J&T Dashboard with delivery tracking, RTS by province analytics

### Role-Based Dashboard
- Admin/CEO: full business overview
- VA: orders focus
- Marketing: ads focus
- Fulfillment: inventory + fulfillment queue

---

## 2026-04-09: Initial Deployment

### Facebook Marketing
- Ad Performance with drill-down (campaigns → adsets → ads)
- Create Ad wizard (campaign → adset → creative → ad)
- Bulk Create (per-row adset, spreadsheet table, bulk file upload)
- Direct browser-to-Facebook uploads (bypasses Vercel limit)
- Ad drafts

### Core Features
- Time Tracker with running timer + manual entry
- Admin attendance view
- Google OAuth login via Supabase
- Dark theme Tailwind CSS v4
- Deployed to Vercel

### Legal Pages
- Privacy Policy, Terms of Service, Data Deletion for Facebook App compliance

---

## Tech Stack
- **Frontend:** Next.js 16 + React + TypeScript + Tailwind CSS v4
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Hosting:** Vercel
- **APIs:** Facebook Marketing API v21.0, Shopify REST API 2024-01
- **AI:** Claude API (Anthropic) — Sonnet 4
- **Dependencies:** xlsx (SheetJS), jsbarcode

## Database Tables
| Table | Purpose |
|-------|---------|
| `employees` | User profiles with roles |
| `time_entries` | Work session tracking |
| `time_pauses` | Pause/resume within sessions |
| `app_settings` | Key-value config (FB token, Anthropic key) |
| `ad_drafts` | Saved ad creation drafts |
| `shopify_stores` | Store credentials (OAuth) |
| `cogs_items` | Cost of goods per SKU |
| `jt_deliveries` | J&T Express delivery tracking |
| `ai_store_docs` | Per-store AI knowledge documents |
| `ai_generations` | AI generation history |
| `bin_locations` | Product shelf locations |
| `inventory_adjustments` | Stock change audit log |
| `cycle_counts` | Cycle count sessions |
| `stock_alert_thresholds` | Low stock alerts |
| `pack_verifications` | Pack verification log |
