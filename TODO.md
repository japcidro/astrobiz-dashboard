# Things To Do

Running list of things to ship / decisions to make. Add items here instead
of letting them drift in chat.

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
