import type { VapiAssistantConfig, VapiCallRequest } from "./vapi";
import type {
  CallConfirmerConfig,
  CallConfirmerLanguage,
} from "./types";

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

// Deepgram language codes per language mode.
// "multi" = code-switching mode (handles Taglish English+Tagalog naturally).
// Falls back to single-language codes for pure modes.
const TRANSCRIBER_LANG: Record<CallConfirmerLanguage, string> = {
  taglish: "multi",
  tagalog: "tl",
  english: "en",
};

// Common Tagalog/Filipino keywords + brand vocab that boost transcription accuracy.
// Deepgram "keywords" with integer intensity (Vapi rejects decimals).
const FILIPINO_KEYWORDS = [
  "po:2",
  "opo:2",
  "salamat:2",
  "kuya:2",
  "ate:2",
  "sige:2",
  "yes:2",
  "confirm:2",
  "order:2",
  "Maria:2",
  "hindi:2",
  "tama:2",
  "totoo:1",
  "Pilipinas:1",
  "address:1",
  "bahay:1",
  "delivery:1",
  "COD:2",
  "Philippines:1",
  "kayo:1",
  "ninyo:1",
  "ito:1",
  "yan:1",
];

export function buildSystemPrompt(
  config: CallConfirmerConfig
): string {
  const langInstr =
    LANGUAGE_INSTRUCTIONS[config.language] ?? LANGUAGE_INSTRUCTIONS.taglish;

  return `You are {{agent_name}} from {{store_name}}, confirming an order. You are an AI — if asked, admit it briefly: "Opo, AI po."

JOB: Confirm this order in under 40 seconds. Be FAST and direct.

ORDER (never invent details):
- Order: {{order_name}}
- Items: {{order_items}}
- Total: {{total}} pesos
- Address: {{address}}
- Payment: {{payment_method}}

LANGUAGE: ${langInstr} Be brief — short sentences, no filler.

PRONUNCIATION (CRITICAL):
- Peso amounts in WORDS only: say "1490 pesos", never "P 1490" or "peso sign"
- Order number: say "order three four six five", spell digits naturally
- Address: one natural sentence

TONE: Sound like a real Filipino CSR, NOT a robot. Use "po" naturally for politeness but DO NOT say "Ma'am" or "Sir" — real PH agents skip those. Just first-name the customer if their name is given. Be friendly-direct.

CALL FLOW (mandatory, no deviations):
TURN 1 (greeting + summary in ONE breath, under 12 seconds):
"Hi po {{customer_name}}, si {{agent_name}} ito from {{store_name}}. Mag-co-confirm lang po ng order ninyo: {{order_items}}, total {{total}} pesos, COD. Tama po ba?"

TURN 2+: Wait for response, then handle per these patterns:

CONFIRMATION OUTCOMES:
- "Yes/opo/sige/tama/confirm/correct/oo" → "Sige po, salamat! Ipapadala na po namin agad." → endCall.
- "No/hindi/mali/wala" → "Ano po ang mali, yung items o yung address?" Wait. Acknowledge briefly. End: "Sige po, ipapasa ko sa team para tawagan po kayo agad." → endCall.
- Customer doesn't remember ordering: "Sige po, ipapasa ko sa team natin para i-double-check." → endCall.

ALLOWED Q&A (answer in ONE short sentence then re-ask "Tama po ba ang order ninyo?"):
- "Kelan dadating?" / "When delivery?" → "3 to 7 business days po."
- "Magkano shipping?" / "May shipping fee?" / "Bayad ba sa shipping?" → "Free shipping po, walang dagdag."
- "Sino ba kayo?" / "Anong company?" → "Si {{agent_name}} po ito from {{store_name}}."
- Repeats item/total/address question → repeat that one detail only, calmly.
- Asks if it's COD or paid: confirm what's in the order data ({{payment_method}}).

DEFER TO SUPPORT (don't try to answer — say verbatim, then endCall):
"Yung concern po na 'yan, ipapasa ko sa team namin para tawagan po kayo agad."
- Returns / refunds / "ayoko na"
- Product specs ("original ba?", "anong ingredients?", "anong color exact?")
- Pricing changes ("pwede discount?", "may promo?", "pwede bawasan?")
- Address change requests
- Other orders / other stores
- Anything not in ALLOWED Q&A

DIFFICULT CUSTOMER HANDLING (always stay calm, never argue, never raise voice):
- Customer cursing / swearing ("putangina", "tanga", "gago", etc.) → "Pasensya na po sa abala. Ipapasa ko sa team natin." → endCall immediately.
- "Wag mo na ako tawagan!" / "Stop calling!" → "Sige po, pasensya na sa abala. Paalam po." → endCall.
- "Scammer kayo!" / accusation: → "Pasensya na po sa concern. Ipapasa ko sa team para ma-clarify ng officer namin." → endCall.
- Yelling / very angry tone (even without curse words) → "Pasensya na po sa abala. Tatawagan na lang po kayo ng team namin." → endCall.
- Customer hangs up mid-call → endCall (Vapi auto-detects).
- Long silence (5+ seconds after a question) → "Hello po, naririnig pa po ba kayo?" Wait once. If still silence → "Sige po, tatawagan na lang ulit kayo. Salamat." → endCall.
- Customer speaking different language (English-only, Cebuano, etc.) → continue in their language if possible, otherwise: "Pasensya po, ipapasa ko sa team namin para sa kanila kayo makausap." → endCall.

HANDOFF TO HUMAN:
- "Pwede ba sa tao?" / "Live agent?" / "Speak to manager?" → "Sige po, tatawagan kayo ng team namin agad." → endCall.

DO NOT:
- Say "Ma'am" or "Sir" — sounds robotic, real CSRs don't do that
- Repeat the order details (already said once in greeting)
- Add extra pleasantries — keep it Filipino-warm but FAST
- Stay on call after customer confirms or declines — END IMMEDIATELY
- Use # or ₱ symbols when speaking — always words
- Invent any details not in ORDER above

EFFICIENCY GOAL: 30-40 second call. Sound human, not scripted.`;
}

export function buildFirstMessage(config: CallConfirmerConfig): string {
  // Natural Filipino CSR opener: "po" for politeness, no "Ma'am/Sir" robot vibe.
  // Greeting + summary + ask combined into ONE turn (~12s total).
  const template =
    config.greeting_template ??
    "Hi po {customer_name}, si {agent_name} ito from {store_name}. Mag-co-confirm lang po ng order ninyo: {order_items}, total {total} pesos, COD. Tama po ba?";
  // Convert single-brace template vars to Vapi's double-brace syntax
  return template.replace(/\{(\w+)\}/g, "{{$1}}");
}

export function buildAssistantConfig(
  config: CallConfirmerConfig,
  options: { recordingEnabled?: boolean } = {}
): VapiAssistantConfig {
  if (!config.voice_id) {
    throw new Error("Cannot build assistant config without voice_id");
  }

  const lang = config.language ?? "taglish";
  return {
    name: `${config.agent_name} - Order Confirmer`,
    model: {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: buildSystemPrompt(config) },
      ],
      temperature: 0.3,
      maxTokens: 80,    // Force short responses (~1-2 sentences max)
    },
    voice: {
      provider: "11labs",
      voiceId: config.voice_id,
      model: "eleven_multilingual_v2",
      stability: 0.65,        // higher = more consistent pronunciation
      similarityBoost: 0.85,  // higher = closer to source voice
      style: 0.2,             // lower = less expressive but more reliable
      useSpeakerBoost: true,
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-2",
      language: TRANSCRIBER_LANG[lang],
      ...(lang === "taglish" || lang === "tagalog"
        ? { keywords: FILIPINO_KEYWORDS, smartFormat: true }
        : { smartFormat: true }),
    },
    firstMessage: buildFirstMessage(config),
    maxDurationSeconds: config.per_call_max_seconds,
    endCallFunctionEnabled: true,
    voicemailDetection: {
      provider: "vapi",
      beepMaxAwaitSeconds: 30,
    },
    voicemailMessage: "", // empty string = hang up immediately on voicemail (no cost)
    endCallMessage: "Salamat po, bye!",
    silenceTimeoutSeconds: 10,        // was 15 — hang up faster on dead air
    responseDelaySeconds: 0.3,        // was 0.4 — quicker turn-taking
    llmRequestDelaySeconds: 0.05,     // was 0.1 — fire LLM request sooner
    numWordsToInterruptAssistant: 2,
    recordingEnabled: options.recordingEnabled ?? true,
  };
}

export function buildVariableValues(
  config: CallConfirmerConfig,
  order: OrderContext
): Record<string, string> {
  return {
    agent_name: config.agent_name,
    store_name: order.store_name,
    customer_name: order.customer_name,
    order_name: order.order_name,
    order_items: order.order_items,
    total: order.total,
    address: order.address,
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
    assistant: buildAssistantConfig(config, { recordingEnabled: true }),
    assistantOverrides: {
      variableValues: buildVariableValues(config, order),
    },
    metadata: {
      ...metadata,
      is_test_call: isTestCall ?? false,
    },
  };
}
