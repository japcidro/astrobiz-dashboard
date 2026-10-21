import { boardGuide } from "./board";
import { adGuides } from "./ads";
import { analyticsGuides } from "./analytics";
import type { Guide } from "./types";

/** Every guide, in the order the Guides page lists them inside each area. */
export const GUIDES: Guide[] = [boardGuide, ...adGuides, ...analyticsGuides];

export function getGuide(id: string): Guide | undefined {
  return GUIDES.find((g) => g.id === id);
}

/** The guides that run on this page. Most pages have one. */
export function guidesFor(pathname: string): Guide[] {
  return GUIDES.filter((g) => g.href === pathname);
}

/** The query parameter that starts a guide when the page opens: /owner/marketing-board?guide=board */
export const GUIDE_PARAM = "guide";

export function guideHref(guide: Guide): string {
  return `${guide.href}?${GUIDE_PARAM}=${encodeURIComponent(guide.id)}`;
}
