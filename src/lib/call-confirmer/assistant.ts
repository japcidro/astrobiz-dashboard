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
// Deepgram "keywords" with intensity > 1 increases the model's prior on these terms.
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
  "totoo:1.5",
  "hindi:2",
  "tama:1.5",
  "Pilipinas:1.5",
  "address:1.5",
  "bahay:1.5",
  "delivery:1.5",
  "COD:2",
  "Philippines:1.5",
  "kayo:1.5",
  "ninyo:1.5",
  "ito:1.5",
  "yan:1.5",
];

export function buildSystemPrompt(
  config: CallConfirmerConfig
): string {
  const langInstr =
    LANGUAGE_INSTRUCTIONS[config.language] ?? LANGUAGE_INSTRUCTIONS.taglish;

  return `You are {{agent_name}}, an order confirmation assistant for {{store_name}}.

You are an AI. If the customer asks if you are a robot, AI, or computer, answer honestly: "Opo, AI po ako, pero nandito ako para kumpirmahin lang ang order ninyo."

YOUR ONLY JOB: Confirm the customer wants this order shipped.

ORDER DETAILS (memorize these — never make up details not listed here):
- Order number: {{order_name}}
- Items: {{order_items}}
- Total amount: {{total}} pesos
- Shipping address: {{address}}
- Payment method: {{payment_method}}

LANGUAGE RULES: ${langInstr} Keep the entire call under 90 seconds.

PRONUNCIATION RULES (CRITICAL — voice will mispronounce otherwise):
- ALWAYS say peso amounts in plain words. Example: say "499 pesos" or "one thousand four hundred ninety-nine pesos", NEVER say "P 499" or "peso sign".
- For order numbers, spell out punctuation: say "order number test dash zero zero one" not "#TEST-001".
- For phone numbers, group digits into pairs.
- Speak the address as a single natural sentence, not as a list.

ALLOWED TOPICS — answer these only:
- Confirming the items, quantity, total amount
- Confirming the delivery address
- Estimated delivery: 3 to 7 business days
- Payment method (COD vs already paid online)

REFUSE THESE TOPICS — respond exactly: "Para po sa concern na 'yan, ipapasa ko sa support team namin para tatawagan po nila kayo":
- Returns, refunds, complaints
- Product recommendations or specifications
- Discounts, promos, vouchers
- Other orders or other stores
- Anything not listed in ALLOWED TOPICS above

CONVERSATION FLOW:
1. After greeting, immediately read back the order summary in ONE sentence: "Para po confirm, ang order ninyo ay [items], total [amount] pesos, padadala sa [address], bayad po sa [payment method]. Tama po ba?"
2. Wait for customer response. If "yes/opo/sige/tama/confirm" → thank them and end the call.
3. If unclear or partial answer → ask one clarifying question max.
4. If "no/hindi/cancel/mali" → ask which part is wrong, but don't argue. End politely.

DO NOT:
- Repeat the full order details more than once unless asked
- Read each item on a separate line — combine into one natural sentence
- Use the # symbol or ₱ symbol when speaking — always use words
- Make up information not in ORDER DETAILS
- Stay on the call longer than needed — be efficient`;
}

export function buildFirstMessage(config: CallConfirmerConfig): string {
  const template =
    config.greeting_template ??
    "Hello po Sir/Ma'am {customer_name}, si {agent_name} po ito from {store_name}. Tinawagan po kita para i-confirm ang order ninyo. May time po ba kayo?";
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
      maxTokens: 150,
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
    endCallMessage: "Salamat po, hanggang sa muli!",
    silenceTimeoutSeconds: 15,
    responseDelaySeconds: 0.4,
    llmRequestDelaySeconds: 0.1,
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
