/**
 * The "create your own" playbook: how an original static ad is planned when
 * there is no reference to adapt. The method is the adswithsimon breakdown of
 * AG1, Ridge and Jones Road statics (start from why the message was chosen,
 * not from the design), plus our house rules. The same rules, with the
 * frame-by-frame notes, live in .claude/skills/original-static-ads; keep the
 * two in step.
 */
export const OWN_PLAYBOOK = `HOW YOU THINK
Never start from what an ad looks like. Start from why this buyer does not buy today, pick the approach that answers it, and only then decide the picture.

APPROACHES (pick from the buyer's hesitation; a plan uses at least three different ones)
- offer: the product is pricey, slow to show results or feels like a commitment, so the ad gives a reason to start now. We cannot stack free gifts like a big brand: lead with the product and its benefit, back it with one proof point from the profile, and use ONE simple offer that is cheap to deliver (free shipping, one add-on, the money-back guarantee, or the profile's discount).
- replacement: the buyer already owns or uses something for this job (another product, a habit, a home remedy). Make the old thing feel outdated by naming what it is ("Not X. Not Y. Not Z.") without showing it; they picture their own. Contrast against the familiar beats a feature list, because features only matter once someone wants to switch.
- trust: the buyer wants someone credible to have picked it. Borrow credibility from who THIS person already looks up to. It is not always a doctor and it changes by generation: a lola, a nanay who raised four kids, a tita who has it together, a coach, an athlete, a barber, a pop-star type. The figure is living proof of what the buyer wants to become.
- identity: the buyer sees themselves as a type of person. A sorting line names that person ("For guys who don't switch jewelry."); they stop, everyone else scrolls on, which is fine. A headline about the person is stronger than a headline about the product.
- situation: the pain shows up in one moment everyone in this audience recognises (a long flight, the 3pm slump, the school line-up, the bathroom drain after a shower). Show that moment, with the product and without it.

RULES EVERY CONCEPT PASSES
1. Swap-the-brand test: it works with no famous founder, no big shoot and no product ecosystem. If it only works for a famous brand, drop it.
2. One person: written for one specific person, named by a trait, a habit or a moment, never a demographic.
3. One second: the headline and the picture are understood at a glance on a phone. If the idea needs polish to make sense, it is weak.
4. Message over polish: an execution that looks like a real person's post (a phone photo, handwriting, story text boxes, a meme) usually gets more spend than a polished layout with a model and a button. Default to native; designed only for replacement and offer.
5. An authority figure is an archetype with clear visual cues that say who they are in one glance (for a pop star: a headset mic, a sequin jacket, a backstage mirror; without the cues she is just a woman). Never a real, named or lookalike celebrity. No doctor, dermatologist or other expert figure when the brand's profile or rules forbid such claims.
6. A headline may have a villain, someone who made this person feel small: the ex, the jealous friend, the strict mother, the officemate who comments. It is a pair: a small setup line, then a bigger payoff line ("Your ex said gummies were lazy." / "Good thing you don't believe in ghosts."). The pair is used only in the authority format, where the setup is the headline and the payoff is the subhead.
7. Do not imitate a big brand's look: no editorial founder portrait, no five-freebie grid, no competitor name. Borrow the reason, never the design.
8. Facts only from the brand profile: no invented price, claim, number, review count or ingredient. A "was" price is the profile's Discount anchor (the brand's highest regular price) against the entry price; compute the % off from that pair and round it down.
9. Each frame carries the hook, the moment, what the product is, and (where the format has room) the offer. A pretty model with a caption is not an ad.
10. Cast like the customer: a real Filipino of the buyer's age and build, in a real home or place, phone camera, uneven light. Never an influencer, a studio glow or a tidy showroom.
11. The headline is ONE line of nine words or fewer; count them. A longer thought is cut, not squeezed in. Every other line is short too (a pill is two to four words, a note or text box under twelve). English or natural Manila Taglish, whichever the profile's tone uses. No em dashes, no line breaks inside a slot.
12. No body before/after unless the marketer's notes ask for one. A comparison shows two situations (with the product, without it); it never uses the words "before" and "after".
13. Keep the brand's compliance line where the pack label is visible, and obey every brand rule.

FORMATS (how the concept is laid out; text slots are the only words on the image)
- sorting_line: the person on the right in their own world, the pack large in the lower-left foreground, a block-caps headline top-left, the brand name small bottom-right. headline = the sorting line, which names the person ("FOR ___ WHO ___."); subhead = the product's name in small caps; callouts = []; cta = "".
- authority: the authority archetype in their world holding the pack toward the camera at chest height, with a plain band on top for two lines. headline = the small setup line; subhead = the big payoff line; callouts = []; cta = "".
- replacement: a dark studio hero of the pack, a three-beat headline, pills pointing at the pack, a strip at the bottom. headline = "NOT X. NOT Y. NOT Z."; subhead = the upgrade in one line; callouts = up to 4 short feature pills; cta = the strip's words.
- native_comparison: ONE phone photo of the situation with two sides, a handwritten note on each: green with a tick on the side with our product, white with a cross on the side without. Our pack is plainly visible on the with-product side, so the photo itself says what made the difference. No logo, no button. headline = ""; subhead = ""; callouts = [the with-product note, the without note] (the note is specific: a duration or place, then the result, like "10 hrs to dublin, tailbone completely fine" / "absolutely not"); cta = "".
- story_post: a real-looking top-down or in-hand phone photo of the product in use, with plain story text boxes, casual, first person. headline = ""; subhead = ""; callouts = 2 or 3 text boxes; cta = "".
- meme: a white card with two simple line-drawn characters, one complaining at the top, one calm at the bottom. headline = the complaint (what a skeptic says about the product, which is really its benefit); subhead = the short answer ("Yes."); callouts = []; cta = a small offer line or "".
- offer: a clean light layout with the pack, a benefit headline, a proof line and one simple offer. headline = the benefit; subhead = the proof; callouts = up to 3 offer items; cta = the next step.

WHAT TO TEST NEXT (for next_test)
A new concept is first tested as two figures or two persons, each with and without the headline, to see whether the face or the line does the work. A winner keeps its figure and gets new sorting lines aimed at other villains or persons, or keeps its comparison and moves to other everyday situations. An angle that gets no spend after several executions is dropped. Winning means spend that keeps coming at an acceptable cost per purchase, not a high return on a small spend.`;

/** What the image model is told about how each format looks, on top of the concept's own design spec. */
export const FORMAT_FINISH: Record<string, string> = {
  sorting_line: "Finish: one real photograph with bold condensed block-caps type set over a calm area of it; the person is mid-moment in their own place, not posing for a catalogue.",
  authority: "Finish: one real photograph below a plain flat band that carries the two lines; the figure's cues (clothing, props, setting) are unmistakable at a glance, and the pack is held up toward the lens, label facing the camera.",
  replacement: "Finish: a designed product hero on a dark studio background with one soft spotlight; white condensed caps; pill labels with thin leader lines to the pack; crisp and minimal.",
  native_comparison: "Finish: an ordinary phone photo, slightly imperfect framing, natural light, no retouching. The notes are handwritten with a finger or marker tool, uneven and a little tilted, exactly as a person scribbles on a photo before posting it. No logo, no button, no designed type, no border.",
  story_post: "Finish: an ordinary phone photo taken at home, slightly imperfect, with plain rounded story text boxes (white with black text) placed like someone typed them in a stories editor, one of them a little tilted. No logo, no designed type.",
  meme: "Finish: a plain white card, two simple black line-drawn cartoon faces drawn by hand (original characters, not existing meme characters), plain bold sans-serif text, lots of white space, deliberately low production.",
  offer: "Finish: a clean light layout, the pack photographed large and sharp, calm serif or sans headline, one highlighted strip for the offer; nothing crowded.",
};
