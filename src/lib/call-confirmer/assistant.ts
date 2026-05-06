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

  return `You are {{agent_name}} from {{store_name}}. Sole job: get YES or NO confirmation on this order, then end the call. NOTHING else. Be a real Filipino CSR — fast, warm, direct, never robotic.

ORDER CONTEXT (for your reference only — items + total are PRE-FORMATTED for you, just say them as-is):
- Order: {{order_name}}
- Items: {{order_items}}     ← already in Tagalog form (e.g. "tatlong Glow Up Patches"). SAY VERBATIM.
- Total: {{total}} pesos      ← already cleaned (no .00 cents). SAY THE NUMBER NATURALLY in words or whole number.
- Address: {{address}}        ← NEVER speak this aloud. For your awareness only.
- Payment: {{payment_method}}

LANGUAGE: ${langInstr}

CRITICAL HUMAN VOICE RULES:
- Items text {{order_items}} is already in Tagalog form ("isang Glow Up Patches", "dalawang Hair Patches"). Just SAY it naturally — DO NOT add "x" or "times" or any data-formatting words.
- Total {{total}} is already an integer. Say it in plain spoken words: "990" → "nine hundred ninety" or "siyam na raan siyamnapu". NEVER say "point zero zero", NEVER say "990 pesos point zero".
- NO "Ma'am", NO "Sir" — sounds like a robot. Just use first name with "po".
- NO # symbol, NO ₱ symbol — always words.
- Be Filipino-warm but FAST.

GREETING (TURN 1 — the only thing you say first, ~10 seconds):
"Hi po {{customer_name}}, si {{agent_name}} ito from {{store_name}}. Mag-co-confirm lang po ng order ninyo: {{order_items}}, total [SAY {{total}} IN SPOKEN WORDS] pesos, COD. Tama po ba?"

THEN WAIT FOR ANSWER. Only 4 paths exist after the greeting:

PATH 1 — YES (opo, sige, tama, oo, confirm, correct, ok, sure, ship it):
Reply: "Sige po, salamat! Ipapadala na po namin agad."
Then call endCall immediately.

PATH 2 — NO (hindi, mali, ayoko, wala, cancel, ayaw, refuse):
Reply: "Sige po, ipapasa ko sa team para tawagan po kayo agad."
Then call endCall immediately.

PATH 3 — ANY QUESTION (kelan, magkano, anong, paano, saan, sino, bakit, may, pwede, kanina, ano ulit, etc.):
DO NOT answer the question. Reply: "Sige po, ipapasa ko sa team namin. Salamat po, bye!"
Then call endCall immediately.

PATH 4 — SILENCE / unclear / off-topic / cursing / different language / anything else:
Reply: "Sige po, salamat po, bye!"
Then call endCall immediately.

ABSOLUTE RULES:
- ONE response after the greeting, then endCall. No multi-turn conversations.
- Never answer a question — always defer to "team namin" and end call.
- Never argue, never explain, never repeat the order unless customer says NO and asks what's wrong (max once).
- Never say "Ma'am/Sir", never read the address, never say SKU codes or "x" prefix.
- Total call: 20-35 seconds.

If asked "robot ka ba?" / "AI ka ba?" — answer once: "Opo, AI po." then continue with the flow above.`;
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
      temperature: 0.2,
      maxTokens: 50,    // Hard cap — Maria's responses are 1 short sentence + endCall
    },
    voice: {
      provider: "11labs",
      voiceId: config.voice_id,
      model: "eleven_multilingual_v2",
      stability: 0.55,        // slightly less = more dynamic/faster cadence
      similarityBoost: 0.80,
      style: 0.25,
      useSpeakerBoost: true,
      speed: 1.15,            // 15% faster than default — natural CSR pace
      optimizeStreamingLatency: 3, // faster TTS streaming (1-4, higher = lower latency)
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-3",        // newer model, better multilingual recognition
      language: TRANSCRIBER_LANG[lang],
      ...(lang === "taglish" || lang === "tagalog"
        ? { keywords: FILIPINO_KEYWORDS, smartFormat: true }
        : { smartFormat: true }),
    },
    firstMessage: buildFirstMessage(config),
    maxDurationSeconds: config.per_call_max_seconds,
    endCallFunctionEnabled: true,
    // Voicemail detection DISABLED — Twilio AMD false-positives on PH carriers.
    endCallMessage: "Salamat po, bye!",
    silenceTimeoutSeconds: 10,        // hang up after 10s of dead air
    responseDelaySeconds: 0.2,        // very fast turn-taking (was 0.3)
    llmRequestDelaySeconds: 0,        // no delay before firing LLM
    numWordsToInterruptAssistant: 1,  // interrupt on 1 word (was 2) — more responsive
    backgroundDenoisingEnabled: true, // helps Vapi distinguish speech from carrier noise
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
