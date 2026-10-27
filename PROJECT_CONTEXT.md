# Astrobiz Dashboard — Full Project Context

## Overview
Internal employee dashboard for Astrobiz, a Filipino ecommerce business running 4+ Shopify stores with Facebook Ads and J&T Express courier. Built to replace Google Sheets + Apps Script workflows with a unified web app.

**Live URL:** https://astrobiz.live
(The old `astrobiz-dashboard.vercel.app` name is dead — it 404s with
`DEPLOYMENT_NOT_FOUND`. Anything that needs the public origin, such as the
Shopify OAuth redirect_uri, must use astrobiz.live.)
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
| `brand_system_prompts` | Per-store system prompt (1 row per brand) | `creative-generator-v2-migration.sql` |
| `brand_reference_files` | Per-store uploaded reference files w/ extracted text | `creative-generator-v2-migration.sql` |
| `ai_generations` | Saved AI chat threads | `ai-tables-migration.sql` |
| `ad_creative_analyses` | Deconstructor output per ad: transcript, hook, classification, scenes (Gemini Flash) | (see crons) |
| `call_coach_consents` | Recording consent signed once per employee (exact wording, IP, UA) | `call-coach-migration.sql` |
| `call_coach_segments` | Call Coach: one voiced minute of shift audio in the private `call-coach` bucket | `call-coach-migration.sql` |
| `call_coach_mic_events` | Call Coach: recorder started/paused/lost/stopped/silent, so gaps are explainable | `call-coach-migration.sql` |
| `call_coach_transcripts` | Call Coach: Gemini transcript per segment (turns with speaker + offset, rendered text) | `call-coach-phase2-migration.sql` |
| `call_coach_reviews` | Call Coach: Claude's review per employee per day (score, rubric averages, counts, summary, coaching) | `call-coach-phase2-migration.sql` |
| `call_coach_calls` | Call Coach: each call Claude found in a day (outcome, scores, flags, moments with timestamps) | `call-coach-phase2-migration.sql` |
| `call_coach_digests` | Call Coach: Opus's Monday digest per VA per week (trend, wins, coaching, training clips, VA note) | `call-coach-phase3-migration.sql` |

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
| `/time-tracker` | Running timer + manual entry + history (all roles). VA and admin shifts are recorded from the PC mic (Call Coach): consent gate on first use, voice-activated 60s segments uploaded to `/api/call-coach/segments`, Break pauses, Clock Out stops |
| `/owner/call-coach` | Call Coach (owner/admin only): per-VA per-day scorecard. `/api/cron/call-coach-transcribe` (every 30 min) sends each stored minute to Gemini 2.5 Flash; `/api/cron/call-coach-review` (11:30 PM PH) has Claude Sonnet 5.5 split the day into calls and score them on a 6-item rubric (editable via `/api/call-coach/rubric`, stored in `app_settings.call_coach_rubric`). "Review now" = `POST /api/call-coach/review`. Moments click-to-play seek the saved minute. `/api/cron/call-coach-digest` (Mon 7 AM PH) has Claude Opus 5.5 write a weekly digest per VA (`call_coach_digests`, also "Write last week's digest" = `POST /api/call-coach/digests`). After each review, alerts land in admin_alerts (`call_coach_no_upsell`, `call_coach_score_drop`, `call_coach_rts_risk`, `call_coach_not_recorded`, `call_coach_digest`) and the VA gets an employee_notification. Audio auto-deleted after 60 days by `/api/cron/call-coach-retention`; transcripts and scores stay |
| `/va/my-calls` | My Calls (va + admin): the VA's own day scores, rubric, coaching notes, per-call summaries and this week's digest note. No audio, no transcripts |
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
| `/marketing/ads-billing` | Ads Billing — per selected ad account: Meta status, unpaid balance, card on file, stores running there, Pay-now deep link into Meta Billing Hub (admin only) |
| `/marketing/create` | Single ad creation wizard (campaign → adset → creative → ad) |
| `/marketing/bulk-create` | Bulk create: per-row adset name + ad, spreadsheet table, bulk file upload |
| `/marketing/drafts` | Saved ad drafts |

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
| `billing` | GET | Selected ad accounts with status, balance, funding source, stores; 5-min cache; admin only |
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
| `generate` | POST | Claude chat with per-brand system prompt + reference files |
| `brand-prompt` | GET/PUT | Per-brand system prompt CRUD |
| `brand-files` | GET | List per-brand reference files |
| `brand-files/upload` | POST | Multipart upload — extracts text from .txt/.md/.docx/.pdf |
| `brand-files/[id]` | DELETE | Remove reference file (Storage + DB) |
| `history` | GET/POST | Save + fetch chat threads (shared per role) |

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

## Creative Loop (where script generation lives)

Script generation runs externally in the user's Claude Max subscription
(separate Claude Project). The dashboard handles the supporting loop
around it:

1. **FB ads run** → metrics flow through the Facebook Insights API
2. **`/api/cron/deconstruct-top-ads`** (1:30 AM daily) picks the top
   spend + purchase ads, runs Gemini Flash deconstruction, writes
   structured analysis (transcript, hook anatomy, scenes, classification,
   format compatibility, etc.) to `ad_creative_analyses`
3. **`/api/cron/detect-alerts`** (every 30 min) fires `new_winner` alerts
   when an ad clears the threshold (7-day spend ≥ ₱5k, ROAS ≥ 5.0)
4. The user reads/uses the analyses + briefing summaries to inform what
   to feed back into their Claude Project knowledge base

### Archived legacy
Earlier iterations of an in-dashboard script generator were built and
removed after the cost reality (Opus 4.7 for the context size) didn't
match the user's flat Claude Max subscription. Two layers archived:

- `ai_store_docs_archive_2026_05` (19 rows) — the v1 knowledge-base model
- `approved_scripts_archive_2026_05` (52 rows) — the v2 curated library
- `approved_script_creatives_archive_2026_05` (16 rows) — manual ad→script links

See `supabase/approved-scripts-rollback-migration.sql` and
`supabase/creative-generator-v2-migration.sql`.

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
  ai-tables-migration.sql            # ai_generations (legacy ai_store_docs dropped)
  creative-generator-v2-migration.sql # brand_system_prompts + brand_reference_files + brand-files bucket
  content-studio-rollback-migration.sql # Drops legacy Content Studio resources
```

## Running Migrations

Migrations live in `supabase/*.sql` and are applied with the runner:

```bash
npm run db:run -- supabase/bonus-tiers-migration.sql   # apply a migration
npm run db:query -- "select count(*) from bonus_tiers" # ad-hoc check
```

`scripts/db.mjs` connects with `SUPABASE_DB_URL` from `.env.local` and sends
the file as one statement batch, so Postgres runs it in a single implicit
transaction — a migration that fails halfway rolls back whole instead of
leaving the schema half-applied. The URL holds the database password and is
never printed.

Write migrations to be **idempotent** (`if not exists`, `drop policy if
exists`, `on conflict do nothing`) so a re-run is always safe, and end any
file that creates a table with `notify pgrst, 'reload schema';` — without it
PostgREST keeps answering "Could not find the table ... in the schema cache"
after the table already exists.

## Environment Variables

| Key | Where | Purpose |
|-----|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + .env.local | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + .env.local | Supabase anon key |
| `NEXT_PUBLIC_APP_URL` | Vercel | App URL for OAuth redirects |
| `SUPABASE_DB_URL` | .env.local only | Postgres URI (Session pooler) used by `npm run db:run`. Never add to Vercel — it is a local admin tool. |

Facebook token + Anthropic API key stored in `app_settings` table (not env vars).
Shopify OAuth tokens stored in `shopify_stores` table.

## Owner space (added 2026-09-29) — read this when picking up on another machine

Only `japcidro@gmail.com` sees it: a switch next to "Astrobiz" in the sidebar
opens `/owner` (server-checked; everyone else gets a 404). Code:
`src/app/(owner)/`, `src/components/hook-studio/`, `src/lib/hook-studio/`,
`src/app/api/owner/hook-studio/`, `src/lib/owner.ts`.

Sidebar tabs: **Home**, **Mobile App** (a group holding UGC Generator and
Hook Studio), **Marketing Board**.

| Page | What it does |
|---|---|
| `/owner/clipper` | Clipper: a reference video (board card's saved copy or upload) → the Mac worker cuts it into clips (ffmpeg scene detection at 0.2, each clip also cut out as a real MP4 with sound, plus a one-frame-per-second strip) → Claude labels each clip talking head / b-roll / Person A,B / brand-heavy. Timeline: split at playhead, merge, "re-detect people changes" (Claude reads the strip). Per clip: **Keep original** (the real cut) or **Swap person**: Nano Banana Pro still with a new person AND our product from the store's brand kit — the person is either generated or a picked image (UGC library / upload) that becomes the project cast (`cast_path`) and is put INTO the real frame; a picked image is never used as the still itself — Claude brand-checks it, owner approves, then Veo 3.1 (default; speaks the talking-head script with its own voice, 4/6/8 s) / Veo 3 / Genjutsu motion copy / Kling. **Veo always starts from our still, never from the real frame.** B-roll voiceovers: ElevenLabs v4, mixed onto the clip by the Mac (original sound ducked), MP3 kept. Previews auto-play muted; reference and ours side by side. Tables `remake_projects/_shots/_brand_kits/_brand_images` (kept the remake_ names); API under `/api/owner/remake`; files under `remake/` and `brand/` in the `marketing-board` bucket. Credits: Veo 3.1 fast 4 cr/s (16/24/32), preview-high 10 cr/s; Veo 3 fast 22 / preview 58; still 2; ElevenLabs ≈0.2 per line. |
| `/owner/science-broll` | Science B-roll Generator: text in (script lines or a description), textbook-style cross-section science clips out, not only hair (scalp, gut, stomach, skin under a patch, a vein, a cell). Rides on the Cartoon Generator (was Cartoon Hooks; `/owner/cartoon-hooks` redirects) tables and worker: a project is a `cartoon_hooks` row of `kind` science / style science; the "character" is the **style anchor** (one still every other still is drawn from); two **looks** (`look`: cinematic 3D medical animation, the default since 20 Oct, modelled on the transdermal-patch reference; or the textbook plate) and five **scales** per beat (`scale`: surface, section, cellular, vessel, body) so a set moves through the body instead of holding one framing; the anchor is passed to every still for render, palette and lighting only, the composition follows the scale; each beat carries a named **move** (cross_section, process, problem=red, calm=green, flow=blue, split, comeback=gold; `src/lib/science-broll/engines.ts`). New worker step `science_check`: Claude reviews every still against the beat's `check_prompt` before the clip; a fail redraws once with the fix in the prompt (`still_redos`), then the clip and the join run as for cartoons. Code `src/lib/science-broll/`, `src/components/science-broll/`, API `/api/owner/science-broll`. Single clips download per beat plus the joined 9:16. 480p default. |
| `/owner/brand-kit` | Brand Kit (added 2026-10-25; was only a panel inside each Clipper project, which still works and links here): per brand (active Shopify stores plus any store with a kit), the product photos (drag-drop, paste or pick several at once, up to 8; Claude labels each form on upload, editable form + one-line description), the **profile** (what the Static Ad Generator planner and the Script Generator know; "Start from template" fills FOLIQ's headings) and the **rules**. Marks which photos the Static Ad Generator attaches (`pickStaticAdPhotos`: first two pack photos + one contents photo). **Models** (added 2026-10-27): the brand's person-library folder named like the store (made on first upload, API `/api/owner/remake/brand-kit/models`); the static ad planner sees the newest 8 as thumbnails and picks the one who fits the reference (`model_pick`), or casts someone itself; never another brand's people. NURTELLE's six AI kids (Soul 2.0) live there. Same tables `remake_brand_kits` / `remake_brand_images` and API `/api/owner/remake/brand-kit` (GET with no store lists every brand's status). |
| `/owner/script-generator` | Script Generator: a winning video ad's script in (pasted, transcribed from a board card's saved copy by the Gemini deconstructor, or one of our own winners), our brand's script out. Claude Opus decodes what won (hook move, beat order, language mix, tone), maps every beat to our line from the Brand Kit profile and the brand's **Winning DNA** (`script_brand_dna`, a brief built from `ad_creative_analyses` joined to purchases via the `script_studio_ad_metrics()` SQL function; FOLIQ's first brief is hand-seeded in the migration, "Rebuild from winners" replaces it), writes 1-4 versions (default 2), and Sonnet reviews each with scores (hook, structure, language, compliance, brand) and one automatic rewrite. Same structure, language and length as the reference; steering is the per-run notes plus a saved per-brand **brief** (`script_brand_dna.marketer_brief`, read before every run). The **winners list** (`script_brand_winners`, cached a day) comes from the ad data (the test ad and its scaled "- Copy" ads summed as one creative; this month from the fresh this_month payload, earlier from the viewed week ranges), newest launch first, with Facebook thumbnails; a creative launched in the window with 2+ purchases on little spend at a strong CPA is listed as an early winner; an ad without a script has a Transcribe button (Gemini via `resolveAdVideo`, saved to `ad_creative_analyses` as `on_demand`), and Rebuild transcribes up to two recent winners first and writes the brief anchored on the last `anchor_days` (45), opening with WHAT IS WINNING NOW. Keep puts the script in the board card's notes. Tables `script_studio_runs/_scripts`, `script_brand_dna`, `script_brand_winners`; code `src/lib/script-studio/`, `src/components/script-studio/`, API `/api/owner/script-generator`. Text only: runs on Vercel, no Mac job, no Higgsfield credits. |
| `/owner/cartoon-generator` | Cartoon Generator (was Cartoon Hooks; the old path redirects): paste a script, Claude splits it into 2-3 s beats, the Mac draws a character and a still per beat (Seedream 5.0 Flash) and animates each (Seedance 2.0 Mini), then joins. Styles: 3D animated, 2D flat, Medical glow, Mixed, and **Mascot world** (added 20 Oct from the MDhair hair-strand film): the personified subject of the script (hair strands with faces on the scalp, fat cells, a capsule) is the character, designed once as the character image and reused in every beat as one or a crowd, acting out the words in its macro world; generic props the script names (a shampoo tube, a dropper, a capsule) may appear. Tables `cartoon_hooks/_beats` (kind cartoon), API `/api/owner/cartoon-hooks`. |
| `/owner/marketing-board` | Marketing Board: paste a TikTok / Ads Library / FB / IG / YouTube link → card in To do; the Mac worker saves a 1080p copy with yt-dlp (job kind `board_fetch`, bucket `marketing-board`); assign a marketer, store, due date; notes thread; drag across To do / In progress / Done; attach outputs (an ad submitted via Create/Bulk Create from `ad_drafts`, played via the FB video source, or an uploaded video). Owner-only for now — it is being built here and moves to the operations dashboard (admin + marketing) when approved; widen `src/lib/marketing-board/auth.ts` and mount the same component under `(dashboard)`. Tables: `marketing_board_items/_comments/_outputs`. |
| `/owner/ugc-generator` | UGC photo in → same shot with a genuinely new person (US audience, "Varied" default, one variation). Nano Banana Pro, 2 cr. Library with confirm-delete. |
| `/owner/hook-studio` | UGC image + skill → silent 9:16 clip. *Higgsfield motion transfer* = Genjutsu copies a reference clip's exact camera motion (≈7 cr/s). *Arcads-style* = Claude writes a shot prompt from the image; Kling 3.0 animates it (1.25 cr/s). Editable titles, confirm-delete. |

**Where it renders.** Not on Vercel. `worker/hook-worker.mjs` runs on Julius's
MacBook Air as launchd agent `com.astrobiz.hook-worker`, claims rows from
`hook_studio_jobs`, runs the Higgsfield CLI (creator-plan credits, account
skills.astrobiz@gmail.com), copies results into the private `hook-studio`
bucket and heartbeats `app_settings.hook_worker_status`. The same worker saves
Marketing Board references with `yt-dlp` (standalone binary at
`~/.local/bin/yt-dlp`; the heartbeat carries its version as `ytdlp`, and the
board shows "yt-dlp missing on the Mac" when it is null). Only that Mac needs
`worker/.env` (Supabase service key) and the CLI login; a second machine
should NOT run the worker. Control: `scripts/hook-worker-install.sh status|logs|stop`.

**Decisions that are not in the code.** Target market is the US; never
default generated people to Filipino; no single-look lock-in; straight or
softly wavy hair; clips are clean (text and the SoulShot screen go on in
CapCut/Meta). Clipper rule (Julius, 2026-10-14): realism first — every clip
starts from a real frame of a real reference and its motion comes from the
real shot or from the marketer's own script; nothing is generated from text
alone. Talking heads are driven by scripts the team writes, never by the
reference's audio. A separate TTS + lipsync chain (Wan/Seedance) was tried
and rejected: the voice never matched the face. Veo generates voice and lips
together instead, always starting from OUR still (generated, or an existing
image), never straight from the real frame. Kling Omni Edit, Gemini edit and Seedance video_edit were
tested for person swaps and rejected (they keep the source face); Seedance
was later removed entirely. Facebook: the app is on Marketing API
*development access*; requesting Standard Access is the real fix (TODO.md).

**Working on another machine.** `git pull`, `npm install`; `.env.local` needs
`SUPABASE_DB_URL` only for `npm run db:run|db:query`. Vercel deploys from
GitHub, so pushing from any machine ships.
