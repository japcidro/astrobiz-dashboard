# Astrobiz Dashboard — Changelog

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
