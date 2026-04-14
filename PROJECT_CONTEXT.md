# Astrobiz Dashboard — Full Project Context

## Overview
Internal employee dashboard for Astrobiz, a Filipino ecommerce business running 4+ Shopify stores with Facebook Ads and J&T Express courier. Built to replace Google Sheets + Apps Script workflows with a unified web app.

**Live URL:** https://astrobiz-dashboard.vercel.app
**Repo:** https://github.com/japcidro/astrobiz-dashboard

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2.2 (App Router, TypeScript) |
| Frontend | React + Tailwind CSS v4 (dark theme) |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Hosting | Vercel (Hobby plan) |
| Auth | Google OAuth via Supabase Auth |
| Facebook API | Marketing API v21.0 |
| Shopify API | REST Admin API 2024-01 (OAuth per store) |
| AI | Claude API (Anthropic) — Sonnet 4 |
| File parsing | xlsx (SheetJS) for J&T/COGS uploads |

## Roles & Access

| Role | Access |
|------|--------|
| **admin** | Everything — CEO dashboard, P&L, settings, team management |
| **va** | Time Tracker, Orders & Parcels |
| **fulfillment** | Time Tracker, Orders & Parcels, Inventory |
| **marketing** | Time Tracker, Ad Performance, Create/Bulk Create Ads, AI Generator |

Team members are pre-registered by admin in Settings (email + role). On first Google sign-in, auth_id auto-links.

## Database Tables (Supabase)

| Table | Purpose | Migration File |
|-------|---------|---------------|
| `employees` | User profiles with roles | `schema.sql` |
| `time_entries` | Work session tracking | `schema.sql` |
| `time_pauses` | Pause/resume within sessions | `schema.sql` |
| `app_settings` | Key-value config (FB token, Anthropic key, selected accounts) | `schema.sql` |
| `ad_drafts` | Saved ad creation drafts | `ad-drafts-migration.sql` |
| `shopify_stores` | Shopify store credentials (OAuth) | `shopify-stores-migration.sql` + `shopify-oauth-migration.sql` |
| `cogs_items` | Cost of goods per SKU per store | `profit-tables-migration.sql` |
| `jt_deliveries` | J&T Express delivery tracking (upsert by waybill) | `profit-tables-migration.sql` |
| `ai_store_docs` | Per-store AI knowledge documents (6 docs + 3 system prompts) | `ai-tables-migration.sql` |
| `ai_generations` | Saved AI generation history | `ai-tables-migration.sql` |

## Pages & Routes

### Dashboard (`/dashboard`)
- **Server component** that fetches employee + time data from Supabase
- Renders role-specific client component:
  - **Admin**: Today's revenue/orders/ad spend/unfulfilled/team hours + This Month totals + Action items
  - **VA**: Hours + order stats + unfulfilled/aging alerts
  - **Marketing**: Hours + ad spend/ROAS/CPA
  - **Fulfillment**: Hours + inventory health

### Time & Attendance
| Route | Description |
|-------|-------------|
| `/time-tracker` | Running timer + manual entry + history (all roles) |
| `/admin/attendance` | Admin view of all employees' time entries |

### P&L (Admin Only)
| Route | Description |
|-------|-------------|
| `/admin/profit` | Net Profit = Revenue - COGS - Ad Spend - Shipping - Returns |
| `/admin/cogs` | COGS management (CSV/XLSX import, inline edit, scan from Shopify) |
| `/admin/jt-dashboard` | J&T delivery tracking, RTS monitoring, province analytics |

**P&L Formula:**
- Revenue: from Shopify orders
- COGS: from `cogs_items` table matched by SKU × quantity
- Ad Spend: from Facebook Insights, attributed to stores by campaign name keywords
- Shipping: 12% of revenue (projected)
- Returns: SRP + shipping cost of returned J&T parcels

**Store-to-Ad Matching:** Campaign/adset names containing keywords → store name
- ILOVEPATCHES / ILP → I LOVE PATCHES
- CAPSULED → CAPSULED
- HIBI → HIBI
- SERINA → SERINA

**J&T Classification:**
- Delivered, In Transit, For Return, Returned, Returned (Aged)
- Province tier cutoffs: Luzon = 5 days, Visayas/Mindanao = 8 days
- For Return counted as Returned in P&L

**25% RTS Worst Case Rule:** When a store has < 200 delivered parcels (all-time), assumes 25% RTS rate. Once 200+ delivered, uses actual J&T data.

### Orders & Inventory
| Route | Description |
|-------|-------------|
| `/va/orders` | Orders across all Shopify stores, date/store/status filters, age tracking (3d yellow, 5d red), click-to-expand detail panel |
| `/fulfillment/inventory` | Stock levels, color-coded (green 10+, yellow 1-9, red 0), product detail panel |

### Marketing
| Route | Description |
|-------|-------------|
| `/marketing/ads` | Ad Performance — campaigns/adsets/ads with drill-down, spend/ROAS/CPA/CTR/Cost per LPV |
| `/marketing/create` | Single ad creation wizard (campaign → adset → creative → ad) |
| `/marketing/bulk-create` | Bulk create: per-row adset name + ad, spreadsheet table, bulk file upload |
| `/marketing/drafts` | Saved ad drafts |
| `/marketing/ai-generator` | AI chat interface (Claude API) with per-store knowledge |
| `/marketing/ai-settings` | Per-store AI knowledge document management (admin only) |

### Settings (`/admin/settings`) — Admin Only
- **Team Management**: Add/edit/remove employees, assign roles
- **Facebook Ads**: Token management, ad account selection
- **Shopify Stores**: OAuth connection per store (Client ID + Secret)
- **AI Settings**: Anthropic API key

### Legal (Public)
| Route | Description |
|-------|-------------|
| `/privacy-policy` | Privacy policy for Facebook App compliance |
| `/terms-of-service` | Terms of service |
| `/data-deletion` | Data deletion instructions |

## API Routes

### Facebook (`/api/facebook/`)
| Route | Method | Purpose |
|-------|--------|---------|
| `all-ads` | GET | Fetch all ads with insights (campaigns, adsets, ads, spend, ROAS, CPA, etc.) |
| `accounts` | GET | List ad accounts |
| `create` | POST | Create campaign + adset + creative + ad (4-step) |
| `create/pages` | GET | List Facebook Pages |
| `create/pixels` | GET | List pixels for an account |
| `create/targeting` | GET | Search targeting interests |
| `create/upload` | POST | Upload image/video to Facebook |
| `drafts` | GET/POST/PUT/DELETE | Ad draft CRUD |
| `manage` | POST | Manage ad status (pause/activate) |
| `token` | GET | Get FB token for client-side uploads |

### Shopify (`/api/shopify/`)
| Route | Method | Purpose |
|-------|--------|---------|
| `orders` | GET | Fetch orders from all stores (parallel, paginated) |
| `inventory` | GET | Fetch products/stock from all stores |
| `stores` | GET | List connected stores (excludes tokens) |
| `auth` | GET | Initiate Shopify OAuth |
| `auth/callback` | GET | OAuth callback, exchanges code for token |

### Profit (`/api/profit/`)
| Route | Method | Purpose |
|-------|--------|---------|
| `daily` | GET | Core P&L aggregation (Shopify + COGS + Meta + J&T) |
| `cogs` | GET/POST/PUT/DELETE | COGS CRUD + CSV bulk import |
| `jt-upload` | POST | Parse & upsert J&T xlsx data (chunked, 100 rows/batch) |
| `jt-data` | GET | Query J&T deliveries with filters |

### AI (`/api/ai/`)
| Route | Method | Purpose |
|-------|--------|---------|
| `generate` | POST | Call Claude API with store knowledge as context |
| `docs` | GET/POST/DELETE | Per-store knowledge document CRUD |
| `history` | GET/POST | Save + fetch generation history (shared) |

### Other
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/team` | GET/POST/PUT/DELETE | Employee CRUD (admin only) |
| `/api/auth/callback` | GET | Supabase OAuth callback |

## Caching Architecture

### Server-Side (in-memory, per Vercel instance)
| Cache | TTL | What |
|-------|-----|------|
| Facebook insights | 10 min | Full ad performance response per date preset |
| Facebook structure | 30 min | Campaigns, adsets, ads statuses (don't change per preset) |
| Shopify orders | 5 min | Orders per date filter + store |
| Shopify inventory | 5 min | Products/stock levels |
| P&L daily | 5 min | Full P&L aggregation |

### Client-Side (`src/lib/client-cache.ts`)
- Global `cachedFetch()` shared across all pages
- 5-10 min TTL depending on endpoint
- Persisted to `sessionStorage` (survives F5 refresh)
- Empty/error responses NOT cached (prevents caching rate-limit errors)
- Manual Refresh button sends `refresh=1` to bypass all caches

### Background Refresh
- Runs every 10 minutes after login
- Warms Shopify endpoints only (orders, inventory, stores)
- Facebook NOT pre-warmed (rate limit sensitive)
- Staggered 3s between each call

## Key Patterns

### Auth Flow
1. Google OAuth → Supabase Auth → `proxy.ts` middleware
2. `getEmployee()` looks up by `auth_id`, falls back to email match for first-time linking
3. Pre-registered employees (added by admin) auto-link on first sign-in

### Facebook Uploads
- Files upload directly from browser to Facebook Graph API
- Bypasses Vercel's 4.5MB serverless function body limit
- Token fetched via `/api/facebook/token`
- Videos > 10MB use Facebook's chunked upload API (4MB chunks)
- Auto-retry up to 3 times with backoff

### Ads Created as ACTIVE
- All ads created with `status: "ACTIVE"` (not PAUSED)
- With scheduled `start_time` (tomorrow by default), they auto-start on that date

### Store Name Normalization
- All store names uppercased in P&L to prevent case mismatches
- Shopify: "I Love Patches" → "I LOVE PATCHES"
- Facebook: matched by campaign name keywords
- J&T: matched by sender name (contains-based)

## AI Generator

### Per-Store Knowledge (9 documents)
6 shared knowledge docs + 3 system instructions:

**Knowledge Docs (shared across all 3 tools):**
1. Market Sophistication Document
2. New Information Prompt Document
3. New Mechanism Prompt Document
4. Origins Edition / Evolved Avatar Training
5. Market Research Document
6. Winning Ad Template

**System Instructions (one per tool):**
7. Angle Generator System Instruction
8. Script Creator System Instruction
9. Format Expansion System Instruction

### Chat Interface
- Full conversation with follow-ups
- Tool selector: Angle Generator | Script Creator | Format Expansion
- Each tool uses its own system instruction + shared knowledge
- Auto-save threads after each AI response
- Shared history across team (admin + marketing)
- Module-level cache for navigation persistence

## Shareable Module

`src/lib/fb-ads-module/` — Self-contained Facebook Marketing API toolkit:
- `fb-api.ts` — Core helpers (POST, GET, upload)
- `create-ad.ts` — Single ad creation
- `bulk-create.ts` — N ads with progress callback
- `fetch-performance.ts` — Full ad performance data
- Zero dependencies, no tokens stored, safe to share

## File Structure

```
src/
  app/
    (auth)/login/                    # Google OAuth login
    (dashboard)/
      dashboard/                     # Role-based home
      admin/
        attendance/                  # Admin attendance view
        settings/                    # Settings (team, FB, Shopify, AI key)
        profit/                      # Net Profit / Daily P&L
        cogs/                        # COGS management
        jt-dashboard/                # J&T delivery tracking
      fulfillment/inventory/         # Stock levels
      marketing/
        ads/                         # Ad Performance
        create/                      # Single ad wizard
        bulk-create/                 # Bulk ad creation
        drafts/                      # Ad drafts
        ai-generator/                # AI chat interface
        ai-settings/                 # AI knowledge docs
      va/orders/                     # Orders & Parcels
      time-tracker/                  # Time tracking
    (legal)/                         # Public policy pages
    api/
      ai/                            # Claude API integration
      auth/                          # Supabase auth callback
      facebook/                      # Facebook Marketing API
      profit/                        # P&L, COGS, J&T
      shopify/                       # Shopify API + OAuth
      team/                          # Employee CRUD
  components/
    ai/                              # AI generator components
    dashboard/                       # Role-based dashboard cards
    inventory/                       # Stock table + detail panel
    layout/                          # Sidebar + background refresh
    marketing/
      bulk-create/                   # Bulk ad spreadsheet + progress
      create/                        # Ad wizard steps
    orders/                          # Order table + detail panel + store manager
    profit/                          # P&L cards, table, COGS, J&T uploader
    settings/                        # Team manager, AI key manager
    timer/                           # Timer + manual entry + history
  lib/
    ai/                              # AI types + doc types
    facebook/                        # FB types + server actions
    fb-ads-module/                   # Shareable FB ads toolkit
    profit/                          # P&L types, store matching, province tiers
    shopify/                         # Shopify types + server actions
    supabase/                        # Client, server, middleware, getEmployee
    client-cache.ts                  # Global client-side cache with sessionStorage
    types.ts                         # Core types (Employee, TimeEntry, etc.)
    time-actions.ts                  # Time tracking server actions
  proxy.ts                           # Next.js 16 auth proxy (replaces middleware.ts)
supabase/
  schema.sql                         # Core tables (employees, time_entries, app_settings)
  ad-drafts-migration.sql            # Ad drafts table
  shopify-stores-migration.sql       # Shopify stores table
  shopify-oauth-migration.sql        # OAuth columns for shopify_stores
  profit-tables-migration.sql        # cogs_items + jt_deliveries
  ai-tables-migration.sql            # ai_store_docs + ai_generations
```

## Environment Variables

| Key | Where | Purpose |
|-----|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + .env.local | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + .env.local | Supabase anon key |
| `NEXT_PUBLIC_APP_URL` | Vercel | App URL for OAuth redirects |

Facebook token + Anthropic API key stored in `app_settings` table (not env vars).
Shopify OAuth tokens stored in `shopify_stores` table.
