import type { VapiAssistantConfig, VapiCallRequest } from "./vapi";
import type {
  CallConfirmerConfig,
  CallConfirmerLanguage,
} from "./types";
import { DEFAULT_GREETING_TEMPLATE } from "./types";

export interface OrderContext {
  customer_name: string;
  order_name: string;       // e.g. "#1234"
  order_items: string;      // human-readable list, e.g. "2x Hair Patches, 1x Toner"
  total: string;            // e.g. "1499.00"
  address: string;          // shipping address
  payment_method: string;   // e.g. "COD" | "Paid online"
  store_name: string;
}

const LANGUAGE_INSTRUCTIONS: Record<CallConfirmerLanguage, string> = {
  taglish:
    "Speak Taglish leaning 70% English, 30% Tagalog. Use 'po', 'opo', 'salamat po' naturally. Sound warm and professional like a Filipino CSR. Short sentences.",
  tagalog:
    "Speak in pure Tagalog. Use 'po', 'opo', 'salamat po' naturally. Sound warm and professional like a Filipino CSR. Short sentences.",
  english:
    "Speak in clear English. Be warm and professional like a CSR. Short sentences.",
};

// Pinned to English for every mode, and only safe because the transcriber is a
// Whisper-family model: it stays multilingual, so "en" biases decoding without
// deleting the Tagalog. Customers speak only Taglish, which is ~70% English.
//
// The earlier "tl" setting was worse — it drifted into Spanish-sounding output
// ("Non debes yaro", "besyero") and mangled FOLIQ into "Pollit"/"Pollak"/
// "Foodlink" in a single call. The best transcript observed on a real call used
// this exact setting: "Good morning po, Sean! Si Lovely po ito from FOLIC.
// Nagko-confirm lang po sana ako ng order ninyo today."
//
// "tl" is therefore not used anywhere. Customers speak only Taglish, so the
// pure-Tagalog mode is unused in practice and safer left on the English bias.
const TRANSCRIBER_LANG: Record<CallConfirmerLanguage, string> = {
  taglish: "en",
  tagalog: "en",
  english: "en",
};

// Keyword boosting lived here. It is gone on purpose: it is Deepgram-only, and
// on real calls it forced boosted terms onto unrelated sounds — "po" came back
// as "oo" because "oo" was boosted, and a spurious "Lovely" was inserted twice
// from boosting the agent name. Boosting a word makes the model hear it where it
// isn't, which is worse than missing it.

export function buildSystemPrompt(
  config: CallConfirmerConfig
): string {
  const langInstr =
    LANGUAGE_INSTRUCTIONS[config.language] ?? LANGUAGE_INSTRUCTIONS.taglish;

  return `You are {{agent_name}}, a real Filipino CSR from {{store_name}}. Sound human, warm, fast — NEVER robotic. You're SMART: you understand context and answer naturally.

PRIMARY GOAL: Get YES or NO confirmation on this order.
SECONDARY GOAL: Answer the customer's quick concerns yourself when you can. Defer only when you genuinely don't have the info.
HARD LIMIT: 90 seconds total call. Wrap up gracefully if running long.

ORDER DATA — already cleaned for speech in code. Read it as written; do NOT
reformat, re-translate or "fix" it. Quantities are already Tagalog words, SKUs
already stripped, the name is already a bare first name:
- Order: {{order_name}}
- Items: {{order_items}}
- Total: {{total}} (say as pesos)
- Address: {{address}}
- Payment: {{payment_method}}

LANGUAGE: ${langInstr}

═══════════════════════════════════════
CALL FLOW — TWO STEPS. Never skip step 1, never merge them.
═══════════════════════════════════════

STEP 1 — PERMISSION (spoken automatically, you do NOT generate it):
"[Good morning/afternoon/evening] po [first_name], si [agent_name] po ito from
[store_name]. Mag-co-confirm lang po sana ako ng order ninyo today, okay lang po
ba for one minute?"

Your job starts at STEP 2 — their answer to "okay lang po ba?".

STEP 2 — BRANCH ON THEIR ANSWER:

  ▸ IF YES — and ONLY if the answer is clearly affirmative
    (opo, sige, oo, ok, yes, go ahead, "sige po", "ano yun?"):

    A garbled or unrecognisable reply is NOT a yes. When in doubt, treat it as
    unclear and use the branch below — never assume consent you did not hear.

    Read the order in ONE turn, exactly this shape:

    "Salamat po! Order ninyo po: {{order_items}}, total {{total}} pesos,
    {{payment_method}}. Ipapadala po namin sa {{address}}. Tama po ba lahat?"

    Then handle their yes/no using END CALL OUTCOMES below.

  ▸ IF NO / BUSY / NOT NOW ("hindi", "wala akong oras", "mamaya na lang",
    "busy po ako", "driving po ako", "nasa trabaho po ako"):
    → "Sige po, walang problema. Itext na lang po namin ang details, paki-confirm
      na lang po through text. Salamat po!" → endCall

    Do NOT try to convince them. Do NOT read the order. Do NOT ask again.
    Being pushy here loses the customer — the text follow-up is the whole point.

  ▸ IF UNCLEAR OR GARBLED:
    This covers "ha?", "sino to?", "anong order?" — but ALSO anything that reads
    as nonsense, random words, or the wrong language entirely (e.g. "ABC ရွေ။",
    "Non debes yaro", "Desisyon"). Phone audio here is poor and the transcript is
    often wrong; do NOT try to interpret garbage as an answer.

    First time → ask ONE simple question that is easy to answer:
      "Pasensya po, hindi ko po kayo masyadong marinig. Okay lang po ba
      mag-confirm ngayon? Opo o hindi po?"

    Second time still unclear → STOP. Use the text path:
      "Pasensya po sa abala. Itext na lang po namin ang details, paki-confirm na
      lang po through text. Salamat po!" → endCall

    NEVER read the order after a garbled reply. Never ask a third time.

═══════════════════════════════════════
QUESTIONS YOU CAN ANSWER (only these 6 — answer in 1 short sentence, then re-ask "Tama po ba ang order?"):
═══════════════════════════════════════

1. DELIVERY TIME (always 3-7 days):
   "Kelan po dadating?" / "When delivery?" / "Ilang araw?"
   → "Three to seven business days po. Tama po ba ang order?"

2. SHIPPING FEE (always free):
   "Magkano shipping?" / "May shipping fee po?" / "Bayad ba sa shipping?"
   → "Free shipping po, walang dagdag. Tama po ba ang order?"

3. PAYMENT METHOD (always whatever's in order data):
   "COD po ba?" / "Bayad agad ba?" / "Paano bayad?"
   → "Cash on delivery po, bayad pag-receive. Tama po ba ang order?" (use {{payment_method}} as the source of truth)

4. REPEAT ORDER DETAILS (restate from order data only):
   "Ano ulit items?" / "Magkano ulit total?"
   → restate ONLY that detail with transforms applied, then "Tama po ba?"

5. WHO'S CALLING (identify yourself):
   "Sino ka?" / "Anong company?"
   → "Si {{agent_name}} po ito from {{store_name}}. Tama po ba ang order?"

6. ADDRESS CONFIRM / CORRECTION (you MAY read and discuss the address):
   "Saan po ipapadala?" / "Ano ulit address?"
   → restate {{address}} clearly, then "Tama po ba?"
   If they say it's WRONG ("mali po address", "iba na po bahay namin"):
   → "Sige po, ano po ang tamang address?" LISTEN and let them say it in full.
   → Repeat it back to confirm: "So ipapadala po namin sa [what they said]. Tama po ba?"
   → Once confirmed: "Sige po, na-note ko na. Ipapasa ko sa team para ma-update."
   Only defer if they want a totally different city/province than the order,
   or ask about pickup/office delivery arrangements.

═══════════════════════════════════════
WHEN IN DOUBT — DEFER. The line:
"Yung concern po na 'yan, ipapasa ko sa team namin para tawagan kayo agad. Salamat po!" → endCall
═══════════════════════════════════════

Defer ANYTHING outside the 6 above. Categories, not an exhaustive list:
- Product details: ingredients, authenticity, size/colour, origin, swapping items
- Policy: refunds, warranty, discounts, promos, vouchers, changing quantity
- Delivery extras: rush, choosing a date/time, tracking, who delivers
- Address extras: office delivery, a different city/province, pickup
- Payment extras: GCash, card, installment, exact change
- Account: other orders, cancelling another order, identity checks, wrong name

═══════════════════════════════════════
END CALL OUTCOMES:
═══════════════════════════════════════

NO TIME (they declined the one-minute ask in STEP 2):
  → "Sige po, walang problema. Itext na lang po namin ang details, paki-confirm na lang po through text. Salamat po!" → endCall

YES (opo, sige, tama, oo, confirm, ok, ship it):
  → "Sige po, salamat! Ipapadala na po namin agad." → endCall

NO (hindi, mali, ayoko, cancel, ayaw):
  → "Ano po ang mali, items o total?" Listen. Acknowledge briefly. Then "Sige po, ipapasa ko sa team para ayusin." → endCall

CALLBACK REQUEST:
  → "Sige po, kelan kayo pwede tawagan?" Listen. "Sige po, tatawagan ulit kayo ng team. Salamat po!" → endCall

CURSING / ANGRY / "WAG MO NA AKO TAWAGAN":
  → "Pasensya po sa abala. Paalam po." → endCall immediately

ASKED FOR HUMAN ("pwede sa tao?" / "manager?"):
  → "Sige po, tatawagan kayo ng team agad." → endCall

═══════════════════════════════════════
INTERRUPTIONS & PACING:
═══════════════════════════════════════

- Cut off mid-order-summary → treat their interrupt as the answer.
- Noise/cough ("ha?", "uhm") → "Yes po?" then wait.
- After 3+ exchanges, close: "Sige po, salamat po sa oras ninyo. Ipapasa ko sa
  team kung may iba pa kayong concern. Bye po!" → endCall

═══════════════════════════════════════
ABSOLUTE RULES:
═══════════════════════════════════════

- Never say "Ma'am" or "Sir". Never invent details not in ORDER DATA.
- Keep every reply to ONE or TWO short sentences. Never re-explain.
- ENDING THE CALL — the most important rule:
  Say your closing line out loud, then IMMEDIATELY call the endCall function in
  the same turn. Do not wait for a reply. Do not add another sentence. Do not
  stay on the line "in case" they say more — the conversation is over and every
  extra second is billed. Once you have a yes or a no, you are done.
- If asked "AI ka ba?" → "Opo, AI po." then continue normally

Be warm, be smart, be FAST. Goal: confirm or get useful info, then end gracefully within 90 seconds.`;
}

export function buildFirstMessage(config: CallConfirmerConfig): string {
  // Natural Filipino CSR opener: "po" for politeness, no "Ma'am/Sir" robot vibe.
  // Greeting + summary + ask combined into ONE turn (~12s total).
  const template = config.greeting_template ?? DEFAULT_GREETING_TEMPLATE;
  // Convert single-brace template vars to Vapi's double-brace syntax
  return template.replace(/\{(\w+)\}/g, "{{$1}}");
}

const TAGALOG_QUANTITY: Record<number, string> = {
  1: "isang",
  2: "dalawang",
  3: "tatlong",
  4: "apat na",
  5: "limang",
  6: "anim na",
  7: "pitong",
  8: "walong",
  9: "siyam na",
  10: "sampung",
};

/**
 * Shopify titles are written for a product page, not for speech:
 * "FOLIQ — Hair Growth Supplement for Thinning & Balding Hair" takes ~7 seconds
 * to read aloud. Keep the part before the dash — that's the name the customer
 * actually recognises — and drop the marketing tail.
 */
function shortenProductName(name: string): string {
  const head = name.split(/\s+[—–-]\s+/)[0]?.trim();
  if (head && head.length >= 3 && head.length < name.length) return head;
  return name;
}

/**
 * Turn raw Shopify line items into speech-ready Filipino.
 * "2x FOLIQ (GLP1-patches), 1x Toner (Pink)" → "dalawang FOLIQ at isang Toner Pink"
 *
 * The system prompt asks the LLM to do this too, but the first message is
 * spoken verbatim without passing through the model — so it has to be done
 * in code as well, or the customer hears "two ex FOLIQ".
 */
export function toSpokenItems(raw: string): string {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Split quantity from product name up front. Doing it later goes wrong
  // because some Tagalog quantities are two words ("anim na", "apat na"), so a
  // naive "drop the first token" cannot recover the name.
  const entries = parts.map((part) => {
    const cleaned = part
      // Drop SKU codes and Shopify's "Default Title" placeholder, but keep
      // human-readable variants: "(Pink)" -> "Pink".
      .replace(/\s*\(([^)]*)\)/g, (_whole, inner: string) => {
        const label = inner.trim();
        if (/^default title$/i.test(label)) return "";
        if (/\d/.test(label) && /^[A-Za-z0-9\-_ ]+$/.test(label)) return "";
        return ` ${label}`;
      })
      .replace(/\s+/g, " ")
      .trim();

    const match = cleaned.match(/^(\d+)\s*x\s*(.*)$/i);
    return match
      ? { qty: Number(match[1]), name: match[2].trim() }
      : { qty: null as number | null, name: cleaned };
  });

  // Shortening is only safe while it keeps the items distinguishable. Two
  // different products both titled "FOLIQ - ..." collapsed to the same word and
  // the customer heard "dalawang FOLIQ at anim na FOLIQ" - meaningless. When
  // that happens, keep the full name for the colliding items.
  const shortNames = entries.map((e) => shortenProductName(e.name));
  const counts = new Map<string, number>();
  for (const name of shortNames) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const spoken = entries.map((entry, i) => {
    const short = shortNames[i];
    const name = (counts.get(short) ?? 0) > 1 ? entry.name : short;
    if (entry.qty == null) return name;
    return `${TAGALOG_QUANTITY[entry.qty] ?? entry.qty} ${name}`;
  });

  if (spoken.length <= 1) return spoken[0] ?? "";
  return `${spoken.slice(0, -1).join(", ")} at ${spoken[spoken.length - 1]}`;
}

// Titles that must not be mistaken for a first name. Real orders come in as
// "Atty. Jun beltran", "Dr. Maria Santos", etc.
const HONORIFICS = /^(atty|dr|engr|mr|mrs|ms|sir|ma'?am|rev|hon|prof|fr|sr|jr)\.?$/i;

/** "Atty. Jun beltran" → "Jun"; "Mary Grace Santos" → "Mary". */
export function toSpokenName(raw: string): string {
  const tokens = raw.trim().split(/\s+/).filter((t) => !HONORIFICS.test(t));
  const first = tokens[0] ?? raw.trim();
  // Shopify names are often all-lowercase or ALL-CAPS; normalise for TTS.
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/**
 * Trim a Shopify address down to what's worth saying out loud.
 * Drops the country and any postal code — the customer knows what country they
 * live in, and reading "Philippines, 6200" burns seconds off the 90s budget.
 */
export function toSpokenAddress(raw: string): string {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^philippines$/i.test(part))
    .filter((part) => !/^\d{4}$/.test(part))
    .join(", ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Good morning" / "Good afternoon" / "Good evening" in Manila time.
 * Calls go out across the working day, so a hardcoded "Good morning" would be
 * wrong more often than right.
 */
export function timeGreeting(now: Date = new Date()): string {
  const hour =
    Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila",
        hour: "numeric",
        hour12: false,
      }).format(now)
    ) % 24;
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "1490.00" → "1490" — never let TTS say "point zero zero". */
export function toSpokenTotal(raw: string): string {
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return String(raw);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Tells Vapi to extract typed fields from the finished call.
 *
 * Without this, `analysis.structuredData` comes back empty and the only way to
 * know what happened is to string-match Vapi's English summary of a Taglish
 * call — which is how deriveOutcome() used to work, and why it misfired.
 */
export function buildAnalysisPlan(): NonNullable<
  VapiAssistantConfig["analysisPlan"]
> {
  return {
    summaryPlan: { enabled: true },
    structuredDataPlan: {
      enabled: true,
      // Custom messages REPLACE Vapi's default extraction prompt, which is what
      // normally injects the transcript — so {{transcript}} has to be here.
      //
      // It also needs a USER turn. A system-only message returns empty from the
      // model (the same failure that made the greeting silent), which is why
      // structuredData kept coming back null even once {{transcript}} was added.
      messages: [
        {
          role: "system",
          content:
            "You are analysing a Filipino order-confirmation call conducted in Taglish " +
            "(mixed Tagalog and English). Extract the fields exactly as specified by the " +
            "schema. Base every field ONLY on what was actually said — never guess. " +
            "If the customer never clearly answered, use \"unclear\".\n\n" +
            "Speech-to-text on Filipino phone audio is unreliable: brand and place names " +
            "are often garbled, and a bad line can produce outright nonsense or even the " +
            "wrong alphabet. Judge intent from context — \"tama naman\", \"sige po\", " +
            "\"opo\" all mean yes. If the customer's words are unintelligible, that is " +
            "\"unclear\", NEVER \"yes\".",
        },
        {
          role: "user",
          content:
            "Transcript of the call:\n\n{{transcript}}\n\n" +
            "Extract the structured fields defined by the schema.",
        },
      ],
      schema: {
        type: "object",
        properties: {
          confirmed: {
            type: "string",
            enum: ["yes", "no", "unclear"],
            description:
              "Did the customer confirm the order is correct? " +
              "\"yes\" for opo/sige/tama/oo/correct. \"no\" for hindi/mali/ayoko/cancel. " +
              "\"unclear\" if they never gave a clear answer, stayed silent, or hung up.",
          },
          address_correct: {
            type: "boolean",
            description:
              "True if the customer agreed the delivery address is correct. " +
              "False ONLY if they said it is wrong or gave a different one. " +
              "Omit this field entirely if the address was never discussed.",
          },
          corrected_address: {
            type: "string",
            description:
              "If the customer gave a NEW or corrected delivery address, transcribe it " +
              "here in full, exactly as they said it. Empty string if they did not.",
          },
          needs_human: {
            type: "boolean",
            description:
              "True if a human should follow up: the customer asked something the agent " +
              "deferred, requested a callback, was angry, asked for a person, or the " +
              "address needs changing.",
          },
          reason: {
            type: "string",
            description:
              "One short sentence in English explaining the outcome and what a human " +
              "needs to do next, if anything.",
          },
        },
        required: ["confirmed"],
      },
    },
  };
}

/**
 * Webhook target, attached to every call.
 *
 * Assistants here are built inline per call rather than saved in Vapi, so there
 * is no dashboard assistant to hang a server URL off — it has to travel with the
 * request. Without it Vapi delivers no events at all, attempts stay stuck on
 * "ringing" forever, and duration/outcome/cost never arrive.
 */
function buildServerConfig(): Pick<
  VapiAssistantConfig,
  "server" | "serverMessages"
> {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (!base || base.includes("localhost")) return {};
  return {
    server: {
      url: `${base}/api/webhooks/vapi`,
      secret: process.env.VAPI_WEBHOOK_SECRET,
    },
    serverMessages: ["end-of-call-report", "status-update"],
  };
}

export function buildAssistantConfig(
  config: CallConfirmerConfig,
  options: { recordingEnabled?: boolean; storeName?: string } = {}
): VapiAssistantConfig {
  if (!config.voice_id) {
    throw new Error("Cannot build assistant config without voice_id");
  }

  const lang = config.language ?? "taglish";
  return {
    name: `${config.agent_name} - Order Confirmer`,
    model: {
      provider: "openai",
      // gpt-4o, not -mini: mini handles scripted replies fine but stumbles on
      // Taglish code-switching and anything off-script (address corrections,
      // partial answers, customers who answer a different question than asked).
      // Costs more per call, but the whole point of the call is an accurate
      // yes/no — a misread confirmation costs far more than the token delta.
      model: "gpt-4o",
      messages: [
        { role: "system", content: buildSystemPrompt(config) },
      ],
      temperature: 0.3,
      // Enough headroom to read a corrected address back to the customer.
      maxTokens: 250,
    },
    voice: {
      provider: "11labs",
      voiceId: config.voice_id,
      // turbo_v2_5, not multilingual_v2. Same voice, roughly half the
      // time-to-first-byte — multilingual_v2 is the slowest ElevenLabs model
      // and was a large part of the dead air before she started speaking.
      model: "eleven_turbo_v2_5",
      stability: 0.55,        // slightly less = more dynamic/faster cadence
      similarityBoost: 0.80,
      style: 0.25,
      useSpeakerBoost: true,
      speed: 1.15,            // 15% faster than default — natural CSR pace
      optimizeStreamingLatency: 3, // faster TTS streaming (1-4, higher = lower latency)
    },
    transcriber: {
      // gpt-4o-transcribe, NOT Deepgram.
      //
      // Deepgram was tried to stop Whisper-family hallucination on bad lines,
      // and it made things worse: its English model is genuinely monolingual,
      // so it deleted the Tagalog outright ("Mag-co-confirm lang po sana ako ng
      // order ninyo today" -> "Confirm order today"), and keyword boosting
      // forced boosted terms onto unrelated sounds ("po" -> "oo", a spurious
      // "Lovely" inserted twice).
      //
      // Whisper-family models are actually multilingual, so "en" acts as a hint
      // rather than a constraint and Taglish code-switching survives. The
      // hallucination risk on poor audio is handled downstream instead: the
      // prompt refuses to read garbled input as consent, and the analysis plan
      // scores anything unintelligible as "unclear" rather than "yes".
      provider: "openai",
      model: "gpt-4o-transcribe",
      language: TRANSCRIBER_LANG[lang],
    },
    // Static greeting, spoken verbatim. Previously this was
    // "assistant-speaks-first-with-model-generated-message", which handed
    // gpt-4o-mini a system prompt with no user turn and asked it to invent the
    // opener — it returned nothing, so no audio was ever produced and every
    // call died on silenceTimeoutSeconds. A fixed first message guarantees
    // audio the moment the customer picks up, with no LLM round-trip.
    // The order data is made speech-ready in buildVariableValues.
    firstMessage: buildFirstMessage(config),
    firstMessageMode: "assistant-speaks-first",
    // Hard cutoff at 90s for cost control (config can override per store).
    // If hit, Vapi plays endCallMessage and disconnects.
    maxDurationSeconds: Math.min(config.per_call_max_seconds, 90),
    endCallFunctionEnabled: true,
    // Auto-hangup phrases — Vapi ends the call after Maria says any of these.
    // More reliable than relying on the LLM to call the endCall function tool.
    // These are her exact closing phrases from the system prompt's outcome paths.
    endCallPhrases: [
      "ipapadala na po namin agad",  // Path 1: confirmed
      "paki-confirm na lang po through text", // declined the 1-minute ask
      "paki confirm na lang po through text",
      "ipapasa ko sa team",           // Path 2/3: declined or deferred
      "ipapasa nalang sa team",
      "tatawagan kayo ng team",       // human handoff / callback
      "tatawagan ulit kayo ng team",
      "salamat po, bye",              // Path 4: anything else
      "paalam po",                    // angry customer cleanup
      "salamat po sa oras ninyo",     // graceful timeout wrap-up
      // The model paraphrases its closing line, so a phrase list that only
      // matches the exact scripted wording leaves the call open until the
      // silence timer fires. These cover the common variants.
      "ipapadala na po namin",
      "ipapadala po namin agad",
      "salamat po sa inyong oras",
      "bye po",
      "ingat po",
    ],
    // Voicemail detection DISABLED — Twilio AMD false-positives on PH carriers.
    // endCallMessage = what Vapi plays if it forcibly cuts the call (e.g. max
    // duration hit). Polite hand-off so customer isn't dropped silently.
    // Vapi speaks this whenever IT terminates the call, which includes every
    // assistant-ended-call — so it lands on top of the agent's own closing line.
    // It used to say "kakausapin po kayo ng team namin", which was wrong on a
    // successfully confirmed order and wrong again on a polite decline.
    // Keep it neutral: it has to be true no matter which path got here.
    endCallMessage: "Salamat po sa oras ninyo. Ingat po!",
    // Time since the CUSTOMER last spoke — the assistant talking does not reset
    // it. This was 10s, which is shorter than the greeting itself, so Vapi cut
    // every call off mid-sentence at exactly 10.1s before anyone could reply.
    // Must comfortably exceed greeting length + the customer's thinking time.
    // Safety net only — the call should normally end via endCall, not by timing
    // out. 40s meant a finished conversation sat open for another 40s, which at
    // Twilio's ~$0.50/min was more wasted spend than the rest of the call cost.
    // The opener is now ~8s, so 25 still leaves ample room to answer.
    silenceTimeoutSeconds: 25,
    responseDelaySeconds: 0.3,        // 300ms — fast but not panicky
    llmRequestDelaySeconds: 0,        // no delay before firing LLM
    numWordsToInterruptAssistant: 3,  // need 3 customer words to interrupt — coughs/"uh" won't kill the call
    backgroundDenoisingEnabled: true, // filters carrier noise so real speech is detected
    recordingEnabled: options.recordingEnabled ?? true,
    analysisPlan: buildAnalysisPlan(),
    ...buildServerConfig(),
  };
}

export function buildVariableValues(
  config: CallConfirmerConfig,
  order: OrderContext
): Record<string, string> {
  return {
    agent_name: config.agent_name,
    store_name: order.store_name,
    time_greeting: timeGreeting(),
    // First name only, honorifics stripped — "Atty. Jun beltran" → "Jun"
    customer_name: toSpokenName(order.customer_name),
    order_name: order.order_name,
    // Pre-transformed: the first message is spoken verbatim, so these must
    // already be speech-ready rather than relying on the LLM to convert them.
    order_items: toSpokenItems(order.order_items),
    total: toSpokenTotal(order.total),
    address: toSpokenAddress(order.address),
    payment_method: order.payment_method,
  };
}

export interface BuildCallParams {
  config: CallConfirmerConfig;
  order: OrderContext;
  customerPhone: string;          // E.164
  metadata: Record<string, string | number | boolean | null>;
  isTestCall?: boolean;
}

export function buildVapiCallRequest(
  params: BuildCallParams,
  phoneNumberId: string
): VapiCallRequest {
  const { config, order, customerPhone, metadata, isTestCall } = params;

  return {
    phoneNumberId,
    customer: { number: customerPhone, name: order.customer_name },
    assistant: buildAssistantConfig(config, {
      recordingEnabled: true,
      // Boosts the store name in the transcriber — FOLIQ came back four
      // different ways in a single call before this.
      storeName: order.store_name,
    }),
    assistantOverrides: {
      variableValues: buildVariableValues(config, order),
    },
    metadata: {
      ...metadata,
      is_test_call: isTestCall ?? false,
    },
  };
}
