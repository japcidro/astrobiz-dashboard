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

// OpenAI Whisper language codes (ISO 639-1). Whisper handles Taglish
// best with "tl" (Tagalog) — it natively supports code-switching with English.
const TRANSCRIBER_LANG: Record<CallConfirmerLanguage, string> = {
  taglish: "tl",
  tagalog: "tl",
  english: "en",
};

export function buildSystemPrompt(
  config: CallConfirmerConfig
): string {
  const langInstr =
    LANGUAGE_INSTRUCTIONS[config.language] ?? LANGUAGE_INSTRUCTIONS.taglish;

  return `You are {{agent_name}}, a real Filipino CSR from {{store_name}}. Sound human, warm, fast — NEVER robotic. You're SMART: you understand context and answer naturally.

PRIMARY GOAL: Get YES or NO confirmation on this order.
SECONDARY GOAL: Answer the customer's quick concerns yourself when you can. Defer only when you genuinely don't have the info.
HARD LIMIT: 90 seconds total call. Wrap up gracefully if running long.

RAW ORDER DATA (your job: translate into natural human speech, see TRANSFORMS below):
- Order: {{order_name}}
- Items: {{order_items}}      ← contains "1x", "2x", possibly SKU codes in parens
- Total: {{total}}             ← may contain ".00" decimals
- Address: {{address}}         ← NEVER speak aloud, just for context
- Payment: {{payment_method}}

LANGUAGE: ${langInstr}

═══════════════════════════════════════
TRANSFORMS — apply these EVERY time you mention order data:
═══════════════════════════════════════

QUANTITIES → Tagalog number + product:
  "1x Glow Up Patches" → "isang Glow Up Patches"
  "2x Hair Patches"   → "dalawang Hair Patches"
  Map: 1=isang, 2=dalawang, 3=tatlong, 4=apat na, 5=limang, 6=anim na,
       7=pitong, 8=walong, 9=siyam na, 10=sampung, 11+=just say number

SKU CODES → strip if all-caps/digits/dashes; keep human labels:
  "Glow Up Patches (GLP1-patches)" → "Glow Up Patches"   (drop SKU)
  "Hair Patches (Pink)"            → "Hair Patches Pink" (keep variant)
  "Toner (Default Title)"          → "Toner"             (drop placeholder)

PESO TOTAL → spoken words, drop ".00":
  "990.00"  → "nine hundred ninety pesos"
  "1490.00" → "one thousand four hundred ninety pesos"
  Never "point zero zero", never "P", never "₱"

CUSTOMER NAME → first name only, no "Ma'am/Sir":
  "Juan Cruz" → "Juan"
  "Mary Grace Santos" → "Mary Grace"

═══════════════════════════════════════
GREETING (turn 1, ~10 seconds, applying ALL transforms above):
═══════════════════════════════════════

"Hi po [first_name], si [agent_name] ito from [store_name]. Mag-co-confirm lang po ng order ninyo: [translated items], total [translated peso amount], COD. Tama po ba?"

EXAMPLE outputs:
• Items "1x Glow Up Patches (GLP1-patches)" + total "990.00" + name "Mary Grace Santos":
  → "Hi po Mary Grace, si Maria ito from I Love Patches. Mag-co-confirm lang po ng order ninyo: isang Glow Up Patches, total nine hundred ninety pesos, COD. Tama po ba?"
• Items "2x Glow Up Patches, 1x Hair Toner" + total "1490.00" + name "Angelica":
  → "Hi po Angelica, si Maria ito from I Love Patches. Mag-co-confirm lang po ng order ninyo: dalawang Glow Up Patches at isang Hair Toner, total one thousand four hundred ninety pesos, COD. Tama po ba?"

═══════════════════════════════════════
QUESTIONS YOU CAN ANSWER (only these 5 — answer in 1 short sentence, then re-ask "Tama po ba ang order?"):
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

═══════════════════════════════════════
WHEN IN DOUBT — DEFER. The line:
"Yung concern po na 'yan, ipapasa ko sa team namin para tawagan kayo agad. Salamat po!" → endCall
═══════════════════════════════════════

Defer for ANYTHING outside the 5 above. Examples (not exhaustive):

PRODUCT QUESTIONS:
- "Original ba 'to?", "Anong ingredients?", "Anong color exact?", "Anong size?"
- "Saan po galing yung product?", "Made in?"
- "Pwede ba mag-palit ng product/size/color?"

POLICY QUESTIONS:
- "May refund po ba?" / "Anong refund policy?"
- "May warranty po ba?"
- "May discount?" / "May promo?" / "May voucher?"
- "Pwede bawasan?" / "Pwede ulitin?"

DELIVERY EDGE CASES:
- "Pwede ba I-rush?" / "Pwede express delivery?"
- "Pwede po ba ibang araw?" / "Pwede ba pinili ko ang time?"
- "Nasaan na po order ko?" / "Anong tracking?"
- "Sino po magde-deliver?"

ADDRESS QUESTIONS — NEVER READ ADDRESS:
- "Saan po address?" / "Anong address ko?" / "Mali po address!"
- "Pwede ibang address?" / "Pwede po sa office na lang?"

PAYMENT EDGE CASES:
- "Pwede po sa GCash?" / "Pwede card?" / "Pwede installment?"
- "May exact change po ba kailangan?"

ACCOUNT / ORDER MANAGEMENT:
- "May ibang order po ako" / "Cancel ko po ung isa pa"
- "Sino nag-order?" / "Verify po identity"
- "Mali po pangalan ko"

ANYTHING ELSE not in the 5 ALLOWED — defer.

═══════════════════════════════════════
END CALL OUTCOMES:
═══════════════════════════════════════

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
INTERRUPTIONS:
═══════════════════════════════════════

- Cut off BEFORE you finish saying items+total → restart greeting: "Ay sandali po, ulitin ko: [full greeting]"
- Cut off AFTER items+total → treat their interrupt as the answer (apply outcomes above)
- Single noise/cough ("ha?", "uhm") → "Yes po?" then wait
- "Ano ulit?" → restate that detail with transforms, then "Tama po ba?"

═══════════════════════════════════════
TIME AWARENESS (CRITICAL — 90 second hard limit):
═══════════════════════════════════════

If the conversation has been going on a while (you've already answered 1-2 questions and customer keeps asking more):
  → Politely close: "Sige po, para po mas mabilis, ipapasa ko sa team natin para sagutin lahat ng concerns ninyo. Tatawagan kayo agad. Tama po ba ang order ninyo?" Get yes/no, then endCall.

If you sense the call has dragged past 60-70 seconds (you've made 3+ exchanges):
  → Wrap up: "Sige po, salamat po sa oras ninyo. Ipapasa ko sa team kung may iba pa kayo concern. Bye po!" → endCall

═══════════════════════════════════════
ABSOLUTE RULES:
═══════════════════════════════════════

- Never say "Ma'am" or "Sir"
- Never read the address aloud
- Never say "x", "1x", "2x" — always Tagalog quantity words
- Never say ".00", "point zero zero", "P", "₱"
- Never invent details not in the ORDER above
- Always end with endCall after final response — don't linger
- If asked "AI ka ba?" → "Opo, AI po." then continue normally

Be warm, be smart, be FAST. Goal: confirm or get useful info, then end gracefully within 90 seconds.`;
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
      maxTokens: 180,   // Greeting + Q&A responses + occasional callback prompts. Still bounded.
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
      // OpenAI gpt-4o-transcribe — highest quality OpenAI ASR, handles
      // Filipino/Taglish best. The cheaper -mini version was hallucinating
      // (random Korean chars, "blow-up patches" misheard).
      // Cost: ~$0.006/min vs $0.003 for mini — worth it for accuracy.
      provider: "openai",
      model: "gpt-4o-transcribe",
      language: TRANSCRIBER_LANG[lang],
    },
    // LLM-generated greeting — Maria uses gpt-4o-mini's brain to translate
    // raw order data ("1x Glow Up Patches" → "isang Glow Up Patches") into
    // natural Filipino CSR speech, instead of just reading variable
    // substitutions verbatim. System prompt has concrete examples.
    firstMessageMode: "assistant-speaks-first-with-model-generated-message",
    // Hard cutoff at 90s for cost control (config can override per store).
    // If hit, Vapi plays endCallMessage and disconnects.
    maxDurationSeconds: Math.min(config.per_call_max_seconds, 90),
    endCallFunctionEnabled: true,
    // Auto-hangup phrases — Vapi ends the call after Maria says any of these.
    // More reliable than relying on the LLM to call the endCall function tool.
    // These are her exact closing phrases from the system prompt's outcome paths.
    endCallPhrases: [
      "ipapadala na po namin agad",  // Path 1: confirmed
      "ipapasa ko sa team",           // Path 2/3: declined or deferred
      "ipapasa nalang sa team",
      "tatawagan kayo ng team",       // human handoff / callback
      "tatawagan ulit kayo ng team",
      "salamat po, bye",              // Path 4: anything else
      "paalam po",                    // angry customer cleanup
      "salamat po sa oras ninyo",     // graceful timeout wrap-up
    ],
    // Voicemail detection DISABLED — Twilio AMD false-positives on PH carriers.
    // endCallMessage = what Vapi plays if it forcibly cuts the call (e.g. max
    // duration hit). Polite hand-off so customer isn't dropped silently.
    endCallMessage: "Pasensya po, kakausapin po kayo ng team namin para sa kabuuan ng order. Salamat po!",
    silenceTimeoutSeconds: 10,        // hang up after 10s of dead air
    responseDelaySeconds: 0.3,        // 300ms — fast but not panicky
    llmRequestDelaySeconds: 0,        // no delay before firing LLM
    numWordsToInterruptAssistant: 3,  // need 3 customer words to interrupt — coughs/"uh" won't kill the call
    backgroundDenoisingEnabled: true, // filters carrier noise so real speech is detected
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
