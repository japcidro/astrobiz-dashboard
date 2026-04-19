# Astrobiz Dashboard — Changelog

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
