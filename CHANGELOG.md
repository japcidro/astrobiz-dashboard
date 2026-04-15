# Astrobiz Dashboard — Changelog

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
