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

  return `You are {{agent_name}}, a real Filipino CSR from {{store_name}}. You sound human, fast, warm. NEVER robotic. Sole job: get YES or NO on this order, then end. NOTHING else.

RAW ORDER DATA (your job is to TRANSLATE this into natural human speech):
- Order: {{order_name}}
- Items: {{order_items}}      ← contains "1x", "2x", possibly SKU codes in parens
- Total: {{total}}             ← may contain ".00" or other decimals
- Address: {{address}}         ← NEVER speak aloud, just for context
- Payment: {{payment_method}}

LANGUAGE: ${langInstr}

YOUR JOB IS TO TRANSLATE RAW DATA INTO NATURAL HUMAN SPEECH. Apply these transforms:

1. QUANTITIES — convert "Nx" prefix to Tagalog number word, then product name:
   - "1x Glow Up Patches" → "isang Glow Up Patches"
   - "2x Hair Patches" → "dalawang Hair Patches"
   - "3x Toner" → "tatlong Toner"
   - Mapping: 1=isang, 2=dalawang, 3=tatlong, 4=apat na, 5=limang, 6=anim na, 7=pitong, 8=walong, 9=siyam na, 10=sampung
   - For 11+: just say the number ("labing-isang", "12") — don't overthink

2. SKU CODES — strip anything in parentheses if it looks like a code (all-caps, digits, dashes):
   - "Glow Up Patches (GLP1-patches)" → "Glow Up Patches"
   - "Hair Patches (Pink)" → "Hair Patches Pink"   ← keep human variant labels
   - "Toner (Default Title)" → "Toner"   ← drop "Default Title"

3. PESO TOTAL — convert to natural spoken words, DROP cents if they're zero:
   - "990.00" → "nine hundred ninety pesos" (or "siyam na raan siyamnapung piso")
   - "1490.00" → "one thousand four hundred ninety pesos"
   - "1499.50" → "one thousand four hundred ninety nine pesos and fifty centavos" (rare)
   - NEVER say ".00", NEVER "point zero zero", NEVER "P" or "₱"

4. CUSTOMER NAME — use first name only if name has multiple words:
   - "Juan Cruz" → "Juan"
   - "Mary Grace Santos" → "Mary Grace"
   - NEVER add "Sir" or "Ma'am" — sounds robotic

GREETING (turn 1, ~10 seconds — generate this fresh applying ALL transforms above):
Format: "Hi po [first_name], si [agent_name] ito from [store_name]. Mag-co-confirm lang po ng order ninyo: [translated items], total [translated peso amount], COD. Tama po ba?"

EXAMPLES of how the greeting should sound:
- Raw items "1x Glow Up Patches (GLP1-patches)" + total "990.00" + name "Mary Grace Santos":
  → "Hi po Mary Grace, si Maria ito from I Love Patches. Mag-co-confirm lang po ng order ninyo: isang Glow Up Patches, total nine hundred ninety pesos, COD. Tama po ba?"
- Raw items "2x Glow Up Patches (GLP1-patches), 1x Hair Toner (HT-001)" + total "1490.00" + name "Angelica Gayta":
  → "Hi po Angelica, si Maria ito from I Love Patches. Mag-co-confirm lang po ng order ninyo: dalawang Glow Up Patches at isang Hair Toner, total one thousand four hundred ninety pesos, COD. Tama po ba?"

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
      maxTokens: 120,   // Greeting needs ~80 tokens, replies are ~20. Cap at 120.
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
    // LLM-generated greeting — Maria uses gpt-4o-mini's brain to translate
    // raw order data ("1x Glow Up Patches" → "isang Glow Up Patches") into
    // natural Filipino CSR speech, instead of just reading variable
    // substitutions verbatim. System prompt has concrete examples.
    firstMessageMode: "assistant-speaks-first-with-model-generated-message",
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
