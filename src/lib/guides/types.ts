/**
 * Guides: short walkthroughs that run on the page itself. The page darkens,
 * a clear box sits on the element a step is about, and a card beside it
 * says what to do. Each guide is a list of steps against `data-guide`
 * names the page puts on its elements; the runner
 * (src/components/guides/guide-runner.tsx) does the rest.
 */

export type GuidePlace = "top" | "bottom" | "left" | "right";

export interface GuideStep {
  /**
   * The `data-guide` value of the element this step points at. A step whose
   * element is not on the page (an empty column, a closed drawer) is skipped.
   */
  target: string;
  title: string;
  /** One to three plain sentences. `**text**` is shown bold. */
  body: string;
  /** Which side of the element the card prefers; it flips when there is no room. */
  place?: GuidePlace;
  /** Shown as a hint under the text; the clear box stays clickable so they can do it. */
  tryIt?: string;
  /** Click this `data-guide` element first, and wait for the target to appear (opens a drawer, a tab). */
  clickBefore?: string;
  /** Click this `data-guide` element when leaving the step (closes what clickBefore opened). */
  clickAfter?: string;
}

export type GuideArea = "board" | "ads" | "analytics" | "tools";

export const AREA_INFO: Record<GuideArea, { title: string; blurb: string }> = {
  board: { title: "Marketing board", blurb: "Where references come in and finished ads go out." },
  ads: { title: "Ad management", blurb: "Getting an ad from a finished video to live on Facebook." },
  analytics: { title: "Analytics", blurb: "Reading the numbers and learning from what won." },
  tools: { title: "Marketing tools", blurb: "The generators. Each guide lands when its tool moves to the team." },
};

export const AREA_ORDER: GuideArea[] = ["board", "ads", "analytics", "tools"];

export interface Guide {
  /** Stable id, saved in guide_progress. */
  id: string;
  area: GuideArea;
  title: string;
  /** One line under the title: what they will be able to do after. */
  blurb: string;
  /** The page the guide runs on; the runner starts when the pathname matches. */
  href: string;
  /** Under the Development Dashboard: only the owner and the marketing team can open it. */
  ownerSpace?: boolean;
  minutes: number;
  steps: GuideStep[];
}

/** What guide_progress holds for one employee and guide. */
export interface GuideProgress {
  guide_id: string;
  last_step: number;
  completed_at: string | null;
  dismissed_at: string | null;
}
