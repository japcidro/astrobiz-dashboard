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

const TRANSCRIBER_LANG: Record<CallConfirmerLanguage, string> = {
  taglish: "en",   // Deepgram nova-2 handles Taglish best as 'en'
  tagalog: "tl",
  english: "en",
};

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
- Total amount: ₱{{total}}
- Shipping address: {{address}}
- Payment method: {{payment_method}}

LANGUAGE RULES: ${langInstr} Keep the entire call under 90 seconds.

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

WHEN TO END THE CALL — use the endCall function:
- Customer confirms order → end the call with a thank-you
- Customer says they did not order this or want to cancel → end the call politely
- Customer wants you to call back later → confirm time, end call
- Customer asks for a human agent OR sounds upset OR asks something off-topic and insists → tell them "Tatawagan po kayo ng team namin", then end the call

DO NOT:
- Repeat the order details unless the customer asks
- Make up information not in ORDER DETAILS
- Discuss anything outside ALLOWED TOPICS
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
      temperature: 0.4,
      maxTokens: 200,
    },
    voice: {
      provider: "11labs",
      voiceId: config.voice_id,
      model: "eleven_multilingual_v2",
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.3,
      useSpeakerBoost: true,
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-2",
      language: TRANSCRIBER_LANG[lang],
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
