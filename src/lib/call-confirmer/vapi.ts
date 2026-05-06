const VAPI_BASE_URL = "https://api.vapi.ai";

export interface VapiCallRequest {
  phoneNumberId: string;
  customer: { number: string; name?: string };
  assistant: VapiAssistantConfig;
  assistantOverrides?: {
    variableValues?: Record<string, string | number>;
  };
  metadata?: Record<string, string | number | boolean | null>;
}

export interface VapiAssistantConfig {
  name?: string;
  model: {
    provider: "openai";
    model: string;
    messages: { role: "system" | "user" | "assistant"; content: string }[];
    temperature?: number;
    maxTokens?: number;
  };
  voice: {
    provider: "11labs";
    voiceId: string;
    model?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
    useSpeakerBoost?: boolean;
    speed?: number;                       // 0.7-1.2 typical, 1.0 = default
    optimizeStreamingLatency?: number;    // 0-4, higher = lower latency
  };
  transcriber: {
    provider: "deepgram";
    model: "nova-2" | "nova-3";
    language: string;
    keywords?: string[];
    smartFormat?: boolean;
  };
  firstMessage?: string;
  firstMessageMode?:
    | "assistant-speaks-first"
    | "assistant-speaks-first-with-model-generated-message"
    | "assistant-waits-for-user";
  maxDurationSeconds: number;
  endCallFunctionEnabled?: boolean;
  voicemailDetection?: {
    provider: "vapi" | "twilio" | "google" | "openai";
    voicemailExpectedDurationSeconds?: number;
    beepMaxAwaitSeconds?: number;
  };
  voicemailMessage?: string;
  endCallMessage?: string;
  silenceTimeoutSeconds?: number;
  responseDelaySeconds?: number;
  llmRequestDelaySeconds?: number;
  numWordsToInterruptAssistant?: number;
  backgroundDenoisingEnabled?: boolean;
  recordingEnabled?: boolean;
  hipaaEnabled?: boolean;
}

export interface VapiCallResponse {
  id: string;
  status: string;
  phoneNumberId: string;
  customer: { number: string };
  cost?: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  endedReason?: string;
  analysis?: {
    summary?: string;
    successEvaluation?: string;
    structuredData?: Record<string, unknown>;
  };
  artifact?: {
    recordingUrl?: string;
    transcript?: string;
    messages?: { role: string; message?: string; content?: string }[];
  };
  messages?: { role: string; message?: string; content?: string }[];
  transcript?: string;
  recordingUrl?: string;
}

export class VapiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string
  ) {
    super(message);
    this.name = "VapiError";
  }
}

export async function createVapiCall(
  payload: VapiCallRequest
): Promise<VapiCallResponse> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) throw new Error("VAPI_API_KEY missing in env");

  const res = await fetch(`${VAPI_BASE_URL}/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new VapiError(
      `Vapi createCall failed: ${res.status}`,
      res.status,
      text
    );
  }

  return JSON.parse(text) as VapiCallResponse;
}

export async function getVapiCall(callId: string): Promise<VapiCallResponse> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) throw new Error("VAPI_API_KEY missing in env");

  const res = await fetch(
    `${VAPI_BASE_URL}/call/${encodeURIComponent(callId)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new VapiError(`Vapi getCall failed: ${res.status}`, res.status, text);
  }
  return (await res.json()) as VapiCallResponse;
}
