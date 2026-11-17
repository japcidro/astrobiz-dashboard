---
name: original-static-ads
description: Plan original static ads for one of our brand pages (FOLIQ, I Love Patches, NURTELLE, HALORINNA, YUMO, CAPSULED…) with no reference ad. Use when asked to "create our own static ads", "plan statics for <page>", "think of new static concepts", "what statics should we test next", or when working on the Create your own mode of the Static Ad Generator. Produces a creative plan per page (concepts with approach, the one person, headline, visual, format, why, next test) for approval BEFORE any image is generated. For adapting a competitor's ad, use the generator's Adapt mode instead.
---

# Original static ads (create your own, no reference)

Method taken from the adswithsimon breakdown "I Studied Every $100M Static Ad So You Don't Have To" (AG1, Ridge, Jones Road, and his agency's own ads). Frame-by-frame notes: [reference/video-breakdown.md](reference/video-breakdown.md). Read it once before planning for the first time.

The one idea: **do not start from what an ad looks like. Start from why that message was chosen, then check whether the reason holds for our customer.**

## Where this runs

- Dashboard: `/owner/image-studio` → **Create your own**. Pick the page, optionally say what the ads should do, get a plan, approve concepts, and only then do renders queue.
- Runtime copy of these rules: `src/lib/image-studio/playbook.ts` (the planner's system prompt). Planner, approval and render queue: `src/lib/image-studio/own.ts`. When a rule changes here, change it there too.
- Live check of the planner without the dashboard: `OWN_ADS_LIVE=FOLIQ OWN_ADS_OUT=/tmp/plan.json npx vitest run src/lib/image-studio/__tests__/own-live.test.ts` (reads the page's real profile, calls Claude, writes the plan).
- Brand facts come only from the Brand Kit profile (`remake_brand_kits.profile`) and the product photos. Never invent a price, claim, review count or ingredient.

## Workflow

1. **Page first.** The plan is for one page. Read its Brand Kit profile, rules, product photos and its recent ad headlines. No profile → say so and plan only from what the photos show.
2. **Find the hesitation.** Why does this buyer not buy today? That picks the approach (table below).
3. **Write the plan** (4 concepts by default, each a different approach or person). For each: the one person, the insight, who they trust, headline, the picture, the format, why it works, what to test next.
4. **Show it for approval.** Layout sketch with the real words, plus the reasoning. Nothing renders yet.
5. **On approval, generate** only the approved concepts, then review each render (product check, text check, 1-second check).
6. **After results:** judge by spend at an acceptable CPA, not ROAS on small spend. Winner → more executions of the same angle. No spend after several executions → drop the angle.

## Step 2: pick the approach from the hesitation

| The buyer's situation | Approach | What the ad does | Big-brand example |
|---|---|---|---|
| Pricey, slow results, commitment feels risky | **Offer** | Gives a reason to start now | AG1: "Free Welcome Kit + Omega 3 + Vitamin D3+K2", crossed-out prices, "Free" |
| Already owns or uses something that does the job | **Replacement** | Makes the old thing feel outdated | Ridge: "NOT LEATHER. NOT BORING. NOT BULKY." |
| Wants an expert's pick, too many choices | **Trust** | Borrows credibility from who they look up to | Jones Road: "Five essentials, chosen by legendary makeup artist, Bobbi Brown" |
| Sees themselves as a type of person | **Identity** | Names the person; they stop, others scroll on | Ridge: "FOR GUYS WHO DON'T SWITCH JEWELRY." |
| The pain shows up in one familiar moment | **Situation** | Shows that exact moment, with and without the product | Seat cushion: "10 hrs to dublin, tailbone completely fine ✓ / absolutely not ✗" |

The same brand can use more than one. A plan covers at least three different approaches.

## Step 3: rules every concept must pass

1. **Swap-the-brand test.** The idea must still work with no famous founder, no big shoot, no product ecosystem. If it only works because it is AG1 or Bobbi Brown, drop it.
2. **One person.** The ad is for one specific person, named by a trait, habit or moment (not "women 25–45"). A headline about the person beats a headline about the product.
3. **One second.** Headline + picture are understood at a glance on a phone. If the idea needs polish to make sense, the idea is weak.
4. **Message over polish.** The same angle in a native, low-polish execution (phone photo, handwriting, story text boxes, meme) usually gets more spend than a polished layout with a model and a CTA button. Default to native unless the approach is Replacement or Offer.
5. **Authority = who THIS person already looks up to.** Not always a doctor, and the right one changes by generation: a grandma, an athlete, a coach, a psychologist, a pop-star type, a tita who has it together. Use an archetype with clear visual cues (the video's pop star needed a headset mic, sequin jacket and a backstage mirror; without them "she's just a blonde woman"). Never a real, named or lookalike celebrity. Never a doctor or expert figure when the brand's compliance line forbids it.
6. **A headline can have a villain.** "Your ex said gummies were lazy. / Good thing you don't believe in ghosts." The villain is someone who made this person feel small: the ex, the jealous friend, the strict mother, the officemate who comments on her lunch. It is a pair (small setup line, bigger payoff line) and it goes with the authority format.
7. **Can't stack freebies? Then:** lead with the product and its benefit, back it with proof from the profile, and use one simple offer that is cheap to deliver: free shipping, one add-on, or the money-back guarantee.
8. **Do not copy:** the editorial famous-founder layout, the five-freebie stack, a competitor's look. Borrow the reason, not the design.

House rules (ours, on top of the video):

- Every frame carries four things: the hook, the moment, what the product is, and the offer or next step. A pretty model plus a caption is AI slop.
- Cast like the customer (a real Filipino of the buyer's age and build, real home, phone camera, uneven light), not like an influencer.
- Headline is one line, nine words or fewer (the plan screen flags longer ones). Taglish when the page speaks Taglish.
- A "was" price always anchors on the brand's highest regular price (the profile's Discount anchor line).
- The pack is reproduced exactly from its photo: real colours, real label, in the scene, front to camera.
- No body before/after unless Julius asks for it in the notes; a comparison shows two situations (with and without the product), with dated or handwritten labels, never the words "before" and "after".
- Keep the brand's compliance line and respect its rules (for example no doctor claims).

## Formats (how the concept is laid out)

| Format | Layout | Text slots |
|---|---|---|
| `sorting_line` | Person on the right in their own world, product large in the lower-left foreground, block-caps headline top-left, logo bottom-right | headline "FOR ___ WHO ___.", subhead = product name |
| `authority` | The authority archetype in their world, holding the pack toward the camera, two-line headline on top (small serif setup line, big bold payoff) | headline = setup, subhead = payoff |
| `replacement` | Dark studio hero of the pack, three-beat headline, feature pills pointing at the pack, CTA strip | headline "NOT X. NOT Y. NOT Z.", subhead = the upgrade, callouts = up to 4 pills, cta |
| `native_comparison` | One phone photo of a familiar situation, two sides, handwritten note on each: green ✓ with the product, white ✗ without | callouts = [with-product note, without note] |
| `story_post` | A real-looking phone photo of the product in use or laid out, with 2–3 plain story text boxes | callouts = the text boxes, casual first-person |
| `meme` | White card, two simple line-drawn characters: one complains, one answers | headline = the complaint, subhead = the short answer, cta = small offer line |
| `offer` | Clean product layout, benefit headline, proof line, one simple offer | headline = benefit, subhead = proof, callouts = offer items, cta |

## Step 6: testing and reading results

- **First test of a new concept:** two authority figures (or two persons), each with and without the headline = four versions. It shows whether the face or the line does the work.
- **If it wins:** keep the winning figure and test new sorting lines, each aimed at a different villain or person; or keep the comparison and move it to other everyday situations (long flight → office chair → long drive → stadium seat).
- **If an angle gets no spend after several executions, move on.**
- **What "winning" means:** spend that Meta keeps giving at an acceptable CPA, with frequency still low (the video's winner: $15k in 30 days, 144 purchases, $101.80 CPA, 1.79 ROAS, frequency 1.63). A great ROAS on $200 proves nothing. Use the page's own CPA target.
- **Reading a competitor's Ad Library:** look at the oldest ads relative to that account (a high-volume brand rotates fast, so five weeks is old), and at concepts with many versions (same format, different creator, product or message = doubling down). Long-running is a place to look, not proof of profit: it may be a small budget, retargeting, or simply not turned off.

## Output: the plan, per page

For each concept give: title, approach, format, the one person, the insight (what they care about or what stops them), the authority figure if any, headline, subhead, other on-image lines, the picture in plain words, native or designed, why it should work, what it borrows and from whom, the next test. Then stop and wait for approval.
