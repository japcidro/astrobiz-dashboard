# Astrobiz Dashboard — Changelog

## TODO: Pre-Deployment Fixes (Before Team Rollout)

### Critical — Must Fix Before Deploy

1. **TypeScript Build Error**
   - File: `src/app/(dashboard)/marketing/ads/page.tsx` line 261
   - Problem: `AdRow` can't be cast directly to `Record<string, unknown>`
   - Fix: Change to `row as unknown as Record<string, unknown>`
   - Impact: `npm run build` fails — cannot deploy to Vercel

2. **Missing `app_settings` Table in Schema**
   - Problem: Code references `app_settings` everywhere (FB token, selected accounts) but table is NOT in `supabase/schema.sql`
   - Impact: New environments will break — table only exists because it was created manually
   - Fix: Add CREATE TABLE + RLS policies to migration file

3. **Remove Debug Logging**
   - Files: `src/app/api/facebook/create/route.ts`, `src/app/api/facebook/create/upload/route.ts`
   - Problem: Writing logs to `/tmp/create-debug.log` and `/tmp/upload-debug.log`
   - Fix: Remove `fs.writeFileSync` debug lines (won't work on Vercel anyway)

### High — Security & Auth

4. **Add Root Middleware for Auth Protection**
   - Problem: Auth check is only at page level, not middleware level — API routes are unprotected
   - Fix: Create `src/middleware.ts` that registers the Supabase auth middleware
   - Impact: Without this, someone could call `/api/facebook/*` directly without logging in

5. **Facebook Token Storage**
   - Problem: System User token stored in plain text in `app_settings` table
   - Consider: Using Supabase Vault or encrypted column

### Medium — Cleanup

6. **Remove Unused/Legacy Files**
   - `src/components/marketing/fb-token-form.tsx` — duplicate of token-manager
   - `src/components/marketing/ads-table.tsx` — superseded by inline table in ads/page.tsx
   - `src/lib/proxy.ts` — empty/unused
   - `src/app/api/facebook/route.ts` — old multi-action route, replaced by individual endpoints

7. **Hide Unbuilt Sidebar Links**
   - Problem: Sidebar shows links to Orders & Parcels, VA Dashboard — features not yet built
   - Fix: Hide or grey out with "Coming Soon" badge

8. **Ad Creation Wizard (~80% done)**
   - Partial endpoints: `/api/facebook/create/pages`, `/pixels`, `/targeting`
   - Step mode select component incomplete
   - Needs full integration test before enabling for team

### Low — Nice to Have

9. **Add `app_settings` RLS documentation** — document what keys exist and who can access
10. **Rate limiting** on Facebook API calls — prevent hitting API limits with many accounts
11. **Error boundaries** — better error handling in ad creation flow

---

## 2026-04-08: Date Filter Fix + Ad Account Selection

### Bug Fix: Date Filter (Today vs Yesterday showing same data)

**Problem:**
Pag nag-switch ka ng date filter from "Today" to "Yesterday" (or vice versa), pareho lang yung lumalabas na data. Hindi nag-uupdate.

**Root Cause:**
- Next.js route handlers nag-cache ng API responses by default
- Browser din nag-cache ng GET requests na same URL

**Fix:**
- Added `export const dynamic = "force-dynamic"` sa dalawang FB API routes para hindi mag-cache si Next.js:
  - `src/app/api/facebook/all-ads/route.ts`
  - `src/app/api/facebook/accounts/route.ts`
- Added timestamp cache-buster (`_t` param) sa client-side fetch para hindi mag-cache ang browser

**Files Changed:**
- `src/app/api/facebook/all-ads/route.ts` — added `force-dynamic`
- `src/app/api/facebook/accounts/route.ts` — added `force-dynamic`
- `src/app/(dashboard)/marketing/ads/page.tsx` — added `_t` cache-buster sa fetch URL

---

### New Feature: Ad Account Selection in Settings

**Problem:**
13 ad accounts ang lumalabas sa Ads dashboard pero 2 lang naman ang ginagamit (MONEYCATCHER at CHINKEE). Ang daming clutter.

**Solution:**
Nag-add ng checkboxes sa Settings page para ma-select kung aling ad accounts lang ang gustong makita sa Ads dashboard.

**How to Use:**
1. Go to **Settings** (`/admin/settings`)
2. Sa "Ad Accounts" section, may checkboxes na per account
3. Check yung mga accounts na gusto mo (e.g. MONEYCATCHER, CHINKEE)
4. Click **"Save Selection"**
5. Go back to **Ad Performance** — yung selected accounts lang ang lalabas
6. Kung walang ni-select, lahat ng accounts lalabas (default behavior)

**How It Works (Technical):**
- Selected account IDs saved sa `app_settings` table with key `fb_selected_accounts` (JSON array)
- `all-ads` API route reads this setting and filters accounts before fetching insights
- Two levels of filtering:
  - **Settings-level** — admin picks which accounts to include globally
  - **Dashboard-level** — user can still filter by individual account via dropdown

**Files Changed:**
- `src/lib/facebook/actions.ts` — new `saveSelectedAccounts()` server action
- `src/app/(dashboard)/admin/settings/page.tsx` — fetches saved selection, passes to TokenManager
- `src/components/marketing/token-manager.tsx` — checkbox UI per account + Save Selection button
- `src/app/api/facebook/all-ads/route.ts` — reads `fb_selected_accounts` and filters before querying FB API

---

## Project Overview

### Tech Stack
- **Frontend:** Next.js 16 + React + TypeScript
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Hosting:** Vercel
- **APIs:** Facebook Marketing API v21.0, Google OAuth

### Completed Phases
| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Time Tracker (running timer + manual entry, admin attendance view) | Done |
| 4 | Facebook Marketing Dashboard (multi-account, flat table, filters, sorting) | Done |

### Pending Phases
| Phase | Feature | Status |
|-------|---------|--------|
| 2 | Shopify API + Fulfillment Dashboard | Not started |
| 3 | VA Dashboard + J&T Express Tracking | Not started |

### Key Files
| File | Purpose |
|------|---------|
| `src/app/api/facebook/all-ads/route.ts` | Main API — fetches all ads data across accounts |
| `src/app/(dashboard)/marketing/ads/page.tsx` | Ads dashboard UI — flat table with filters & sorting |
| `src/app/(dashboard)/admin/settings/page.tsx` | Settings — token management + account selection |
| `src/components/marketing/token-manager.tsx` | Token form + account checkboxes UI |
| `src/lib/facebook/actions.ts` | Server actions — save token, save selected accounts |
| `src/lib/facebook/api.ts` | FB Marketing API helper functions |
| `src/app/api/facebook/accounts/route.ts` | API — test/fetch ad accounts for a token |

### Database (Supabase)
**`app_settings` table keys:**
| Key | Value | Purpose |
|-----|-------|---------|
| `fb_access_token` | System User token | FB API authentication |
| `fb_ad_account_id` | `"all"` | Legacy — kept for compat |
| `fb_selected_accounts` | JSON array of account IDs | Which accounts show in dashboard |
