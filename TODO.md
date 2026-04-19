# Things To Do

Running list of things to ship / decisions to make. Add items here instead
of letting them drift in chat.

---

## Manual setup pending (from recent commits)

### 1. Run pending Supabase migrations
Order matters — copy each file's full SQL into Supabase SQL Editor and Run.

- [ ] `supabase/admin-alerts-migration.sql`
      Tables: `admin_alerts`, `inventory_snapshots`. RPC: `insert_admin_alert`.
      Powers the bell icon + `/admin/notifications` + decision feed.
- [ ] `supabase/briefings-migration.sql`
      Table: `briefings`. Powers `/admin/briefings` list + detail.
- [ ] `supabase/attendance-improvements-migration.sql`
      Tables: `employee_shifts`, `employee_notifications`, `attendance_events`.
      RPC: `insert_employee_notification`. Powers schedule editor + reminders.

### 2. Set Vercel env vars (Settings → Environment Variables)

If not already set, add these — tick all 3 environments (Production / Preview / Development) → redeploy after.

- [ ] `RESEND_API_KEY` = `re_...` (from resend.com)
- [ ] `ALERTS_EMAIL_FROM` = `Astrobiz Alerts <onboarding@resend.dev>`
      (until a verified domain is added)
- [ ] `ALERT_RECIPIENTS` = `japcidro@gmail.com`
      (Resend testing mode — only the signup email can receive)
- [ ] `NEXT_PUBLIC_APP_URL` = `https://astrobiz-dashboard.vercel.app`

### 3. Set this week's employee shifts

- [ ] Open `/admin/attendance/schedule`
- [ ] Set start/end + break for each of the 6 employees, per day
- [ ] After this week, use "Copy last week" instead of re-entering

### 4. Smoke-test attendance system

- [ ] Set your own shift for today (start = 1h ago, end = 8h later)
- [ ] Don't clock in
- [ ] Trigger cron manually:
      `curl -H "Authorization: Bearer $CRON_SECRET" https://astrobiz-dashboard.vercel.app/api/cron/attendance-check`
- [ ] Verify: response shows `clockin_reminders: 1`, bell shows badge,
      banner shows red "Not clocked in" with CTA, email arrives in Gmail

### 5. Smoke-test briefings

- [ ] Trigger morning briefing manually:
      `curl -H "Authorization: Bearer $CRON_SECRET" https://astrobiz-dashboard.vercel.app/api/cron/briefing-morning`
- [ ] Verify: numbers are non-zero (RLS fix should have resolved this),
      AI summary reads sensibly, email arrives, briefing visible at
      `/admin/briefings`

### 6. Security follow-up — rotate CRON_SECRET

The current secret was pasted in chat during debugging. Before going to
production, rotate it:

- [ ] Generate new value: `openssl rand -hex 32`
- [ ] Vercel → Settings → Env Vars → edit `CRON_SECRET` → paste new
- [ ] Redeploy
- [ ] Re-test one cron with new secret

### 7. Long-term: get a domain for Resend

While on `onboarding@resend.dev`, only `japcidro@gmail.com` receives
emails. Other admins + employee reminder emails silently fail.

- [ ] Buy a cheap domain (porkbun.com, namecheap.com — ₱500-600/year)
- [ ] Resend → Domains → Add → follow DNS verification
- [ ] Once verified, change `ALERTS_EMAIL_FROM` to use the new domain
      and remove `ALERT_RECIPIENTS` so all admins + employees get emails
- [ ] Bonus: point the same domain at Vercel as a custom domain

---

## AI Analytics — Creative Deconstruction

### FB token scope upgrade (blocks dark-post video analysis)
- **Symptom**: Video resolver reaches the video ID but
  `/{video_id}?fields=source` returns null, so Gemini can't see the video.
  Error surfaced as "Video ... exists but Facebook returned no source URL"
  or (after fallback chain) "no playable MP4 URL could be retrieved".
- **Root cause**: Current FB access token doesn't have page-level access to
  the FB Page running the dark post. Dark-post videos require the token to
  have `pages_read_engagement` on the owning Page, not just ads access.
- **Fix path** (pick one, both work):
  1. **Regenerate user token** in Graph API Explorer / Meta for Developers
     with these scopes:
     `ads_read, ads_management, pages_read_engagement, pages_show_list,
      business_management`
     Then paste into Admin → Settings → Facebook Access Token.
  2. **Use a Business Manager System User token** (preferred long-term) —
     assign the System User to the ad accounts AND the Pages running ads,
     then generate a non-expiring token. This also removes the 60-day
     token refresh churn.
- **Verification**: after updating the token, retry an ad that previously
  failed (e.g. CAP-041426-JO2). Should reach "Downloading video…" stage.

### Maybe later
- Threshold colors on the CPP badge once AOV is known
  (e.g. green if CPP < 0.4 × AOV, red above). Need to decide per-store.
- Hover-preview the ad video inline on the card (read FB embed iframe)
  so you don't even need to click through to FB to eyeball a candidate.
- Chat context: currently each chat turn re-sends the ad snapshot.
  For long sessions with lots of data, switch to tool-use so Claude
  pulls only what it needs.
- Cron scope bump — once dark-post access works, raise
  `MAX_ANALYSES` in `/api/cron/deconstruct-top-ads` back to 10, or make
  it dynamic based on the p95 analysis time.

---

## Housekeeping
- Add a "Re-analyze all stale" admin button on the Audit page
  (deconstructions older than 30 days).
