import { describe, it, expect, afterEach } from "vitest";
import {
  buildAnalysisPlan,
  buildAssistantConfig,
  buildFirstMessage,
  buildTranscriberKeywords,
  buildSystemPrompt,
  toSpokenAddress,
  toSpokenItems,
  toSpokenName,
  toSpokenTotal,
  timeGreeting,
} from "../assistant";
import { DEFAULT_GREETING_TEMPLATE } from "../types";
import type { CallConfirmerConfig } from "../types";

const config = {
  agent_name: "Lovely",
  language: "taglish",
  voice_id: "QLnWW2Ca2TrMd1BrMM4v",
  greeting_template: DEFAULT_GREETING_TEMPLATE,
  per_call_max_seconds: 300,
} as CallConfirmerConfig;

describe("speech transforms", () => {
  it("converts quantities to Tagalog and strips SKU codes", () => {
    expect(toSpokenItems("1x Glow Up Patches (GLP1-patches)")).toBe(
      "isang Glow Up Patches"
    );
    expect(toSpokenItems("1x Toner (Default Title)")).toBe("isang Toner");
  });

  it("drops the marketing tail after a dash to keep the greeting short", () => {
    expect(
      toSpokenItems("2x FOLIQ  — Hair Growth Supplement for Thinning & Balding Hair")
    ).toBe("dalawang FOLIQ");
    // No dash: keep the whole name.
    expect(toSpokenItems("2x Hair Patches")).toBe("dalawang Hair Patches");
    // Hyphens inside a token are not separators.
    expect(toSpokenItems("1x Vitamin B-12")).toBe("isang Vitamin B-12");
  });

  it("keeps human-readable variants and joins multiple items with 'at'", () => {
    expect(toSpokenItems("2x Hair Patches (Pink), 1x Toner")).toBe(
      "dalawang Hair Patches Pink at isang Toner"
    );
  });

  it("falls back to the digit for quantities above ten", () => {
    expect(toSpokenItems("12x Toner")).toBe("12 Toner");
  });

  it("drops trailing .00 so TTS never says 'point zero zero'", () => {
    expect(toSpokenTotal("1490.00")).toBe("1490");
    expect(toSpokenTotal("1,490.50")).toBe("1490.50");
  });

  it("strips honorifics so 'Atty. Jun' is not greeted as 'Atty.'", () => {
    expect(toSpokenName("Atty. Jun beltran")).toBe("Jun");
    expect(toSpokenName("mary grace santos")).toBe("Mary");
    expect(toSpokenName("Chunky Baybay")).toBe("Chunky");
  });

  it("drops country and postal code from the address", () => {
    expect(
      toSpokenAddress("Burgos Street, Sta. Catalina, Negros Oriental, Philippines")
    ).toBe("Burgos Street, Sta. Catalina, Negros Oriental");
    expect(toSpokenAddress("Rizal Ave, Cebu City, 6000, Philippines")).toBe(
      "Rizal Ave, Cebu City"
    );
  });
});

describe("first message", () => {
  it("is set on the assistant so the call never opens with silence", () => {
    const assistant = buildAssistantConfig(config);
    expect(assistant.firstMessage).toBeTruthy();
    expect(assistant.firstMessageMode).toBe("assistant-speaks-first");
  });

  it("gives the customer longer to reply than the greeting takes to say", () => {
    const assistant = buildAssistantConfig(config);
    // Vapi's silence timer counts from the customer's last utterance and is NOT
    // reset by the assistant speaking. At 10s it cut every call off mid-greeting.
    const wordsInGreeting = (assistant.firstMessage ?? "").split(/\s+/).length;
    const secondsToSpeak = wordsInGreeting / 2.5; // ~2.5 words/sec at speed 1.15
    expect(assistant.silenceTimeoutSeconds).toBeGreaterThan(secondsToSpeak);
  });

  it("converts template vars to Vapi's double-brace syntax", () => {
    const fm = buildFirstMessage(config);
    expect(fm).toContain("{{time_greeting}}");
    expect(fm).toContain("{{customer_name}}");
    expect(fm).not.toMatch(/\{[a-z_]+\}(?!\})/);
  });

  it("asks permission and does NOT read the order yet", () => {
    const fm = buildFirstMessage(config);
    expect(fm).toMatch(/okay lang po ba/i);
    // The order summary belongs to step 2, only after the customer agrees.
    expect(fm).not.toContain("{{order_items}}");
    expect(fm).not.toContain("{{total}}");
    expect(fm).not.toContain("{{address}}");
  });

  it("renders a short, clean opener", () => {
    const values: Record<string, string> = {
      time_greeting: "Good morning",
      customer_name: toSpokenName("Atty. Jun beltran"),
      agent_name: "Lovely",
      store_name: "FOLIQ",
    };
    const spoken = DEFAULT_GREETING_TEMPLATE.replace(
      /\{(\w+)\}/g,
      (_m, key: string) => values[key] ?? `{${key}}`
    );
    expect(spoken).toBe(
      "Good morning po Jun, si Lovely po ito from FOLIQ. " +
        "Mag-co-confirm lang po sana ako ng order ninyo today, okay lang po ba for one minute?"
    );
    // Short enough that nobody hangs up before the ask lands.
    expect(spoken.split(/\s+/).length).toBeLessThan(30);
  });

  it("picks the greeting from Manila time, not the server's timezone", () => {
    // 02:00 UTC = 10:00 in Manila (UTC+8)
    expect(timeGreeting(new Date("2026-08-17T02:00:00Z"))).toBe("Good morning");
    // 06:00 UTC = 14:00 Manila
    expect(timeGreeting(new Date("2026-08-17T06:00:00Z"))).toBe("Good afternoon");
    // 13:00 UTC = 21:00 Manila
    expect(timeGreeting(new Date("2026-08-17T13:00:00Z"))).toBe("Good evening");
    // 16:00 UTC = 00:00 Manila — must not overflow to hour 24
    expect(timeGreeting(new Date("2026-08-17T16:00:00Z"))).toBe("Good morning");
  });
});

describe("system prompt", () => {
  it("permits the address now that the order summary reads it aloud", () => {
    const prompt = buildSystemPrompt(config);
    expect(prompt).not.toContain("Never read the address aloud");
    expect(prompt).not.toContain("NEVER speak aloud");
    expect(prompt).toContain("ADDRESS CONFIRM / CORRECTION");
  });

  it("defines the two-step flow with a text fallback when they decline", () => {
    const prompt = buildSystemPrompt(config);
    expect(prompt).toContain("CALL FLOW — TWO STEPS");
    expect(prompt).toMatch(/IF NO \/ BUSY \/ NOT NOW/);
    expect(prompt).toContain("paki-confirm na lang po through text");
    // Never pressure a customer who said no.
    expect(prompt).toContain("Do NOT try to convince them");
  });

  it("ends the call on the text-fallback phrase", () => {
    const assistant = buildAssistantConfig(config);
    expect(assistant.endCallPhrases).toContain(
      "paki-confirm na lang po through text"
    );
  });
});

describe("analysis plan", () => {
  it("requests structured extraction with a required confirmed field", () => {
    const plan = buildAnalysisPlan();
    const schema = plan.structuredDataPlan?.schema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(plan.structuredDataPlan?.enabled).toBe(true);
    expect(schema.required).toContain("confirmed");
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining([
        "confirmed",
        "address_correct",
        "corrected_address",
        "needs_human",
      ])
    );
  });

  it("is attached to the assistant config", () => {
    expect(buildAssistantConfig(config).analysisPlan?.structuredDataPlan?.enabled).toBe(
      true
    );
  });

  it("injects the transcript, since custom messages replace Vapi's default prompt", () => {
    const messages = buildAnalysisPlan().structuredDataPlan?.messages ?? [];
    // Without this the analyser has nothing to read and returns null.
    expect(messages.some((m) => m.content.includes("{{transcript}}"))).toBe(true);
  });

  it("includes a user turn — a system-only prompt returns empty", () => {
    const messages = buildAnalysisPlan().structuredDataPlan?.messages ?? [];
    const user = messages.find((m) => m.role === "user");
    expect(user).toBeDefined();
    expect(user?.content).toContain("{{transcript}}");
  });
});

describe("transcriber", () => {
  it("uses Deepgram, which degrades quietly on bad phone audio", () => {
    const t = buildAssistantConfig(config).transcriber;
    expect(t.provider).toBe("deepgram");
  });

  it("pins the language so it cannot switch alphabets mid-call", () => {
    // A free-floating language produced Burmese script and Spanish on real calls.
    for (const language of ["taglish", "tagalog", "english"] as const) {
      const t = buildAssistantConfig({ ...config, language }).transcriber;
      expect(t.language).toBe("en");
    }
  });

  it("boosts the words that decide the call", () => {
    const kw = buildTranscriberKeywords(config, "FOLIQ");
    const terms = kw.map((k) => k.split(":")[0]);
    // The expensive miss is a refusal read as consent.
    expect(terms).toEqual(expect.arrayContaining(["opo", "hindi", "mali", "ayoko"]));
    // Proper nouns an English model cannot guess.
    expect(kw).toContain("FOLIQ:3");
    expect(kw).toContain("Lovely:3");
  });

  it("handles a missing store name without emitting a broken term", () => {
    const kw = buildTranscriberKeywords(config, undefined);
    expect(kw.every((k) => /^[^:]+:\d+$/.test(k))).toBe(true);
  });
});

describe("webhook wiring", () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = original;
  });

  it("points Vapi at the webhook so attempts do not sit on 'ringing'", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://dash.example.com/";
    const assistant = buildAssistantConfig(config);
    expect(assistant.server?.url).toBe(
      "https://dash.example.com/api/webhooks/vapi"
    );
    expect(assistant.serverMessages).toContain("end-of-call-report");
  });

  it("omits the server on localhost, where Vapi cannot reach us", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(buildAssistantConfig(config).server).toBeUndefined();
  });
});

describe("call ending", () => {
  it("uses a closing message that is true on every path", () => {
    const assistant = buildAssistantConfig(config);
    // Vapi speaks endCallMessage on every assistant-ended call, so it must not
    // claim the team will follow up — that is wrong on a confirmed order.
    expect(assistant.endCallMessage).not.toMatch(/kakausapin|team/i);
    expect(assistant.endCallMessage).toMatch(/salamat/i);
  });
});
