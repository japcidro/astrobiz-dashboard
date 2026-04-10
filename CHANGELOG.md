# Astrobiz Dashboard — Changelog

## 2026-04-10: Major Feature Release

### Net Profit / Daily P&L (CEO Only)
- **Net Profit page** (`/admin/profit`) — full P&L dashboard
  - Formula: `Net Profit = Revenue - COGS - Ad Spend - Shipping - Returns`
  - 6 summary cards: Revenue, COGS, Ad Spend, Shipping, Returns, Net Profit
  - Daily P&L table with totals row, margin %, green/red profit coloring
  - Date filters: Today, Yesterday, Last 7/30/90 Days, This Month, Custom
  - Store filter: ALL or per-store
  - 25% worst-case RTS rule until store reaches 200+ delivered parcels
  - Missing COGS warning with link to COGS page
- **COGS Management** (`/admin/cogs`) — cost of goods per SKU
  - CSV/XLSX file upload for bulk import
  - "Scan from Shopify" to auto-populate SKUs
  - Inline editing per row
- **J&T Dashboard** (`/admin/jt-dashboard`) — delivery tracking
  - Upload J&T Express .xlsx reports
  - 7 summary cards: Total, Delivered, In Transit, For Return, Returned, Aged, COD
  - Store breakdown table with delivery rate %
  - RTS table: all returned/aging parcels sorted by urgency
  - Province tier cutoffs: Luzon 5d, VisMin 8d
  - Sender name normalization (ILOVEPATCHES → I LOVE PATCHES)
- **Database**: `cogs_items` + `jt_deliveries` tables with RLS
- **Sidebar**: Collapsible P&L group (Net Profit, COGS, J&T Dashboard)

### Inventory Dashboard
- **Inventory page** (`/fulfillment/inventory`) — stock levels across all Shopify stores
  - 5 summary cards: Total Products, Variants, Out of Stock, Low Stock, Total Units
  - Sortable table by stock level (lowest first)
  - Color-coded: green (10+), yellow (1-9), red (0)
  - Click product → slide-out detail panel with all variants, SKU, barcode
  - Filters: store, stock status, product type, search
  - Price column admin-only
  - Uses existing `read_products` Shopify scope (no reconnection needed)

### Role-Based Dashboard
- **Admin/CEO**: Today's revenue/orders/ad spend/unfulfilled/team hours + This Month totals + Action items
- **VA**: Hours + today's order stats + unfulfilled/aging alerts
- **Marketing**: Hours + ad spend/ROAS/CPA/purchases
- **Fulfillment**: Hours + out-of-stock/low stock/total units
- Each role fetches only the APIs it needs
- Dashboard client cache for instant back-navigation

### Shopify OAuth Integration
- Replaced manual token input with OAuth flow (Client ID + Secret → Connect → approve)
- Multi-store support via OAuth per store
- Store management in Settings (add/edit/remove/toggle active)

### Orders & Parcels
- **Orders page** (`/va/orders`) — all orders across 4+ Shopify stores
  - Date filters, store filter, status filter, search
  - 6 summary cards with aging warnings
  - Age tracking: 3+ days yellow, 5+ days red
  - COD detection, payment/fulfillment badges
  - Click order → slide-out detail panel with customer info, line items, tracking, totals
  - Revenue/price hidden from non-admin users

### Bulk Ad Creation
- **Bulk Create** (`/marketing/bulk-create`) — create N ads at once
  - Per-row adset name (1 adset = 1 ad for split testing)
  - Bulk file upload (auto-detects image/video from MIME type)
  - Default copy fill for all rows + per-row override
  - Sequential submission with progress overlay + retry failed
  - Visual indicators for missing required fields (red borders, checklist)
  - Ads created as ACTIVE (not PAUSED) — auto-starts on scheduled date

### Ad Creation Improvements
- Adset start date defaults to tomorrow
- Pixel auto-matches page name (fuzzy word match)
- Upload directly to Facebook from browser (bypasses Vercel 4.5MB limit)
- Detailed Facebook API error messages with endpoint/code/subcode

### Performance Optimization
- Server cache TTL increased to 5 minutes (was 3)
- Removed `_t` cache-buster from all auto-fetches (was defeating cache)
- Manual Refresh button sends `refresh=1` to bypass cache
- Dashboard module-level client cache for instant back-navigation

### Deployment & Legal
- Deployed to Vercel at `astrobiz-dashboard.vercel.app`
- Privacy Policy, Terms of Service, Data Deletion pages for Facebook App compliance
- Supabase auth proxy (Next.js 16 `proxy.ts` convention)
- Pre-deployment cleanup: removed debug logging, unused files

### Facebook Ads Module (Shareable)
- Self-contained module at `src/lib/fb-ads-module/`
- Zero dependencies — just needs FB token + account ID
- `createAd()` — single ad creation
- `bulkCreateAds()` — N ads with progress callback
- Upload helpers for image/video
- Copy entire folder to any Next.js project

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `employees` | User profiles with roles |
| `time_entries` | Work session tracking |
| `time_pauses` | Pause/resume within sessions |
| `app_settings` | Key-value config (FB token, selected accounts) |
| `ad_drafts` | Saved ad creation drafts |
| `shopify_stores` | Store credentials (OAuth tokens) |
| `cogs_items` | Cost of goods per SKU per store |
| `jt_deliveries` | J&T Express delivery tracking |

## Tech Stack
- **Frontend:** Next.js 16 + React + TypeScript + Tailwind CSS v4
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Hosting:** Vercel
- **APIs:** Facebook Marketing API v21.0, Shopify REST API 2024-01
- **Dependencies:** xlsx (SheetJS) for J&T/COGS file parsing
