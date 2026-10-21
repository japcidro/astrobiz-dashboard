/** Ask the GuideRunner on this page to start a guide. Pages call this from a "?" button. */
export const GUIDE_START_EVENT = "astrobiz:guide-start";

export function startGuide(id: string): void {
  window.dispatchEvent(new CustomEvent(GUIDE_START_EVENT, { detail: id }));
}
