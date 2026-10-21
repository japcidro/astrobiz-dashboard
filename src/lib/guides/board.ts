import type { Guide } from "./types";

/** The Marketing board, start to finish. Targets are in src/components/marketing-board. */
export const boardGuide: Guide = {
  id: "board",
  area: "board",
  title: "The board, start to finish",
  blurb: "Paste a reference, get it assigned, move it across, attach the finished ad.",
  href: "/owner/marketing-board",
  ownerSpace: true,
  minutes: 2,
  steps: [
    {
      target: "board.tabs",
      place: "bottom",
      title: "Videos or images",
      body: "The board has two tabs. **Videos** is for reference ads. **Images** is for posts and image ads. Everything else works the same on both.",
    },
    {
      target: "board.add",
      place: "bottom",
      title: "Paste a reference link",
      body: "TikTok, Ads Library, Facebook, Instagram or YouTube. The card appears in To do straight away, and the Mac saves a 1080p copy in the background. A spinner on the thumbnail means it is still saving.",
      tryIt: "Try it: click the box and paste a link. The walkthrough waits.",
    },
    {
      target: "board.upload",
      place: "bottom",
      title: "Or upload a file",
      body: "Ads you downloaded from a spy tool, or anything a link cannot reach. You can also drop files anywhere on the page, as many as you like.",
    },
    {
      target: "board.columns",
      place: "top",
      title: "Three columns",
      body: "Drag a card to **In progress** when you start on it, and to **Done** once the ad is submitted. Julius sees the board move, so there is nothing to report.",
    },
    {
      target: "board.card",
      place: "right",
      title: "Reading a card",
      body: "Where it came from, which store, who has it and when it is due. A red due date is overdue. The counts are notes and finished ads attached.",
    },
    {
      target: "board.drawer",
      place: "left",
      clickBefore: "board.card",
      clickAfter: "board.close",
      title: "The card drawer",
      body: "Click a card to open it. The instructions and questions live in the notes thread. When the ad is submitted through Create ad or Bulk create, attach it under **Output** so the reference and the result stay together.",
    },
    {
      target: "board.archive",
      place: "bottom",
      title: "Done, then Archive",
      body: "A Done card leaves the board 12 hours after it is finished and goes to the Archive. Nothing is lost. Search there by title when you need an old one.",
    },
  ],
};
