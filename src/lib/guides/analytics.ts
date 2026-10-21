import type { Guide } from "./types";

/**
 * Analytics guides: reading the numbers and learning from what won.
 * Targets are on each page under src/app/(dashboard)/marketing and the
 * components they render from src/components/marketing and src/components/kpi.
 */

const adPerformance: Guide = {
  id: "ad-performance",
  area: "analytics",
  title: "Ad performance",
  blurb: "Read the Facebook numbers by campaign, ad set and ad, and act on them.",
  href: "/marketing/ads",
  minutes: 3,
  steps: [
    {
      target: "ad-performance.dates",
      place: "bottom",
      title: "Pick a window",
      body: "The numbers are Facebook's, bucketed by Philippine time. Today and Yesterday can lag by an hour or three, so Last 7 Days is the safer read. **Custom** needs a start, an end and Apply, because an unsaved range is a fresh pull from Facebook.",
      tryIt: "Try it: switch to Last 7 Days. The table re-reads and the walkthrough waits.",
    },
    {
      target: "ad-performance.filters",
      place: "bottom",
      title: "Account and status",
      body: "**Account** reloads the table for one ad account. **Status** keeps only ads in that delivery state. Untick **Show zero-spend ads** to hide ads that spent nothing in the window.",
    },
    {
      target: "ad-performance.table",
      place: "top",
      title: "Campaigns, ad sets, ads",
      body: "The table starts at campaigns. Click a campaign to see its ad sets, and an ad set to see its ads; the trail above the table takes you back up. Click any column heading to sort by it.",
    },
    {
      target: "ad-performance.row",
      place: "bottom",
      title: "What a row says",
      body: "**Flags** stays empty unless something needs you: REJECTED is an ad Facebook turned down, ISSUES is a policy or billing hold, SCHEDULED has not started, SCALED means a creative here already runs in a scaling campaign. **Budget** is per day or for the lifetime, and the count column is how many ad sets or ads are live out of how many exist.",
    },
    {
      target: "ad-performance.cpa",
      place: "bottom",
      title: "Reading CPA",
      body: "Cost per purchase. Green is under ₱200, yellow up to ₱350, red above that. It is also red when an ad has spent but bought nothing yet, which is the earliest sign of a bleeder.",
    },
    {
      target: "ad-performance.ad-actions",
      place: "left",
      title: "At the ad level",
      body: "**View** plays the ad in a popup. **Analyze** opens it on the Creatives page and runs the deconstruction. **Promote** copies the ad into a scaling campaign: you pick the campaign and ad set, and whether the copy starts paused or active. It disappears once the creative is already scaled.",
    },
    {
      target: "ad-performance.refresh",
      place: "bottom",
      title: "Refresh",
      body: "Pulls fresh numbers from Facebook. The line under the title says when the table was last refreshed and whether it came from the cache. If a refresh ran a moment ago, or Facebook is rate-limiting us, a banner says the numbers are cached.",
    },
    {
      target: "ad-performance.quick-actions",
      place: "bottom",
      title: "Quick actions",
      body: "Admin only. **Kill Bleeders** lists active ads that spent ₱380 with no purchase or sit above ₱380 CPA, and pauses them in one go. **Boost Winners** raises the budget 20% on active ad sets at ₱200 CPA or better with at least two purchases. The thresholds are editable and you see the list before anything is sent.",
    },
    {
      target: "ad-performance.autopilot",
      place: "bottom",
      title: "Autopilot",
      body: "Admin only. When on, it checks the watched campaigns every hour, pauses ads that reach the spend limit with no purchase or go over the CPA limit, and turns an ad back on if late purchases bring its CPA under the limit. The **Campaigns** tab picks what it watches and **Activity** shows every pause and resume.",
    },
  ],
};

const creatives: Guide = {
  id: "creatives",
  area: "analytics",
  title: "Creatives",
  blurb: "Find the ads worth studying, deconstruct them, and build the Log from winners and losers.",
  href: "/marketing/creatives",
  minutes: 3,
  steps: [
    {
      target: "creatives.tabs",
      place: "bottom",
      title: "Two tabs",
      body: "**All Creatives** is every ad with spend in the window. **Log Pool** is the ads you have tagged for the Log, winners and notable losers, and they stay there whatever the date window says.",
    },
    {
      target: "creatives.filters",
      place: "bottom",
      title: "Narrow the list",
      body: "Date window, store, ad account and campaign type. It starts on **Testing only** because that is where new winners show up. **Scaling only** also lists scaling ads with no spend yet, so you can check that a promoted ad landed.",
    },
    {
      target: "creatives.search",
      place: "bottom",
      title: "Search",
      body: "Matches the ad name or the campaign name as you type.",
      tryIt: "Try it: type part of an ad name. The walkthrough waits.",
    },
    {
      target: "creatives.row",
      place: "bottom",
      title: "Open an ad",
      body: "Click a row to deconstruct it. The modal takes the ad's saved transcript and runs the 8-zone ILP report; the same transcript is never analysed twice, so a repeat open is instant. If no transcript exists yet you can have Gemini transcribe the video on the spot, which takes a minute or two.",
    },
    {
      target: "creatives.status",
      place: "right",
      title: "Status and the pause button",
      body: "The badge is the ad's delivery state on Facebook. The pause or play button next to it flips the ad right away. When an ad is off, the small line under the badge says who paused it, or that Autopilot did and which rule fired.",
    },
    {
      target: "creatives.columns",
      place: "bottom",
      title: "Reading the columns",
      body: "**ROAS** is green from 5x and yellow from 2x. **CPP** is cost per purchase, blank when nothing sold. **Analyzed** shows v2.0 when the current 8-zone report exists and legacy for an older one. **Winner** shows your call for ads in the Log Pool.",
    },
    {
      target: "creatives.pool-toolbar",
      place: "bottom",
      clickBefore: "creatives.tab-pool",
      clickAfter: "creatives.tab-all",
      title: "The Log Pool",
      body: "Add an ad from inside its deconstruction with **Add to Log Pool**. Every pooled ad carries a Winner or Loser badge; click it to flip your call, and the Log takes that call as the truth, not the metrics. **Generate Log** writes the ILP Winning Ad Log from the pool, for the store you have filtered, ready to copy or download for the Claude Project.",
    },
    {
      target: "creatives.refresh",
      place: "bottom",
      title: "Refresh",
      body: "Re-pulls the ads from Facebook and the tags behind them. A refresh within a minute of the last one is throttled and the line beside the button says so.",
    },
  ],
};

const aiAnalytics: Guide = {
  id: "ai-analytics",
  area: "analytics",
  title: "AI Analytics",
  blurb: "Ask questions about your ads in plain language and get answers from live data.",
  href: "/marketing/ai-analytics",
  minutes: 2,
  steps: [
    {
      target: "ai-analytics.dates",
      place: "bottom",
      title: "The default window",
      body: "The preset you pick here is the window the assistant assumes when your question does not say one. Say a different range in the message and it uses that instead. To look at one account, name it in the question.",
      tryIt: "Try it: pick Last 30 Days. The scope line above the message box follows.",
    },
    {
      target: "ai-analytics.creatives-link",
      place: "bottom",
      title: "Deconstruction lives elsewhere",
      body: "Breaking an ad down zone by zone, and tagging winners, happens on the Creatives page. This link takes you there. This page is for questions.",
    },
    {
      target: "ai-analytics.prompts",
      place: "top",
      title: "Starter questions",
      body: "Click one to send it as is. The assistant can pull live Facebook performance, past deconstructions, comparative reports, scaling campaigns and Autopilot activity, and it answers in Taglish or English, whichever you use.",
    },
    {
      target: "ai-analytics.input",
      place: "top",
      title: "Ask anything",
      body: "Enter sends, Shift+Enter starts a new line. The line above the box shows the window in play.",
      tryIt: "Try it: click the box and type a question. Sending it can wait until the walkthrough is done.",
    },
    {
      target: "ai-analytics.messages",
      place: "top",
      title: "What comes back",
      body: "Replies stream in. A small chip above each reply says how many tools it used; click it to see which data it pulled and how long each took. A session has a cost cap of about two dollars, and a yellow note warns you before it is reached. Start a new chat to reset it.",
    },
    {
      target: "ai-analytics.toolbar",
      place: "bottom",
      title: "Saved chats",
      body: "Every chat is saved once the assistant answers. **History** lists them to reopen or delete, and **New chat** starts a fresh one with the cost counter at zero.",
    },
  ],
};

const deconstructor: Guide = {
  id: "deconstructor",
  area: "analytics",
  title: "Ad Deconstructor",
  blurb: "Paste any ad transcript and get the 8-zone ILP report with its compliance audit.",
  href: "/marketing/deconstructor",
  minutes: 2,
  steps: [
    {
      target: "deconstructor.input",
      place: "bottom",
      title: "Paste the transcript",
      body: "Any ad works: a competitor's, a reference, or your own draft. Add the scene log or on-screen text if you have them; more context gives a sharper read.",
      tryIt: "Try it: paste a transcript into the box. Nothing runs until you click Deconstruct.",
    },
    {
      target: "deconstructor.run",
      place: "left",
      title: "Deconstruct",
      body: "Sends the text to Claude Sonnet 4.6 and takes 10 to 30 seconds. The result is saved to the history on the right, so you can come back to it.",
    },
    {
      target: "deconstructor.output",
      place: "top",
      title: "The eight zones",
      body: "A is the snapshot, B the structural anatomy, C the ILP system mapping, D the avatar decode, E mechanism fidelity, F the compliance audit, G the verbatim language bank and H the marketer takeaways. Each zone collapses on click and has its own **Copy**.",
    },
    {
      target: "deconstructor.result-header",
      place: "bottom",
      title: "The flag count",
      body: "The badge counts every FLAG raised in zones E and F: a claim the mechanism cannot support, or a line that would not pass ad review. Red means fix before the ad runs, green means nothing was raised.",
    },
    {
      target: "deconstructor.history",
      place: "left",
      title: "History",
      body: "Every deconstruction you have run, with its origin, its flag count and when it ran. Click one to load it back into the page. The bin on hover deletes it after a confirmation.",
    },
  ],
};

const transcriber: Guide = {
  id: "transcriber",
  area: "analytics",
  title: "Transcriber",
  blurb: "Turn a batch of videos into transcripts, tone-of-voice notes and a music breakdown.",
  href: "/marketing/transcriber",
  minutes: 2,
  steps: [
    {
      target: "transcriber.intro",
      place: "bottom",
      title: "What it does",
      body: "Give it ad videos and Gemini listens to each one: the transcript with timestamps, how each speaker sounds, what the music is, and the sound design along the timeline. Good for studying a reference before you brief a cut.",
    },
    {
      target: "transcriber.dropzone",
      place: "bottom",
      title: "Add videos",
      body: "Drop mp4, mov or webm files here, or click to choose. Up to 500MB each, as many as you like. Files only queue at this point; nothing uploads until you start.",
      tryIt: "Try it: drop a video on the box. It joins the queue below.",
    },
    {
      target: "transcriber.actions",
      place: "bottom",
      title: "Run the batch",
      body: "**Transcribe** starts the queue, two videos at a time. **Stop** cancels what is still waiting. Once more than one is done, **Download all** saves every report in one markdown file, and **Clear** empties the queue.",
    },
    {
      target: "transcriber.job",
      place: "bottom",
      title: "Each file",
      body: "The line under the name moves from Queued to Uploading with a percentage, then Transcribing, then Done or Failed with the reason. A failed file is retried the next time you click Transcribe. The chevron opens the report and the cross removes the file.",
    },
    {
      target: "transcriber.result",
      place: "top",
      title: "The report",
      body: "**Transcript** with a clean version without timestamps, **Tone of voice** per speaker with a casting note, **Music** with genre, tempo, mood and where to find something similar, and the audio timeline. **Copy all** or the .md button takes the whole report with you.",
    },
  ],
};

const creativeAttribution: Guide = {
  id: "creative-attribution",
  area: "analytics",
  title: "Creative attribution",
  blurb: "Claim the ads you made so they count toward your creatives tested KPI.",
  href: "/marketing/creative-tagging",
  minutes: 2,
  steps: [
    {
      target: "creative-attribution.intro",
      place: "bottom",
      title: "Why claim an ad",
      body: "The creatives tested per week KPI counts the ads tagged to your name. Nothing is counted on its own; a new creative only counts once you claim it here.",
    },
    {
      target: "creative-attribution.ad-id",
      place: "bottom",
      title: "The ad ID",
      body: "The ad's ID from Ads Manager, numbers only. **Ad name** is optional and only labels the entry in the list below.",
      tryIt: "Try it: click the field and type an ID. Nothing is saved until you click Claim ad.",
    },
    {
      target: "creative-attribution.test",
      place: "bottom",
      title: "New test or a copy",
      body: "Leave the box ticked for a new creative. Untick it for a duplicate or a scaling copy of something that already ran; those are recorded but do not count toward the KPI.",
    },
    {
      target: "creative-attribution.submit",
      place: "right",
      title: "Claim ad",
      body: "Saves the ad under your name and the KPI picks it up on its next compute. Claiming an ID that someone already claimed moves it to you, so check the list first.",
    },
    {
      target: "creative-attribution.list",
      place: "top",
      title: "Tagged this week",
      body: "Everyone's claims from the last seven days, with the ID, whether it was a test or a copy, and who claimed it. The refresh arrow at the top re-reads the list.",
    },
  ],
};

/** Analytics guides, in the order the Guides page lists them. */
export const analyticsGuides: Guide[] = [
  adPerformance,
  creatives,
  aiAnalytics,
  deconstructor,
  transcriber,
  creativeAttribution,
];
