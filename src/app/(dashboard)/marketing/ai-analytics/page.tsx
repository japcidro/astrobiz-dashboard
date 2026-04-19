"use client";

import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Send,
  RefreshCw,
  Sparkles,
  Video,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { DatePreset } from "@/lib/facebook/types";

const DATE_PRESETS: { label: string; value: DatePreset }[] = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 Days", value: "last_7d" },
  { label: "Last 14 Days", value: "last_14d" },
  { label: "Last 30 Days", value: "last_30d" },
  { label: "This Month", value: "this_month" },
  { label: "Last Month", value: "last_month" },
];

interface AdRow {
  account: string;
  account_id: string;
  campaign: string;
  adset: string;
  ad: string;
  ad_id: string;
  status: string;
  spend: number;
  link_clicks: number;
  cpa: number;
  roas: number;
  add_to_cart: number;
  purchases: number;
  landing_page_views: number;
  cost_per_lpv: number;
  reach: number;
  impressions: number;
  ctr: number;
}

interface AccountInfo {
  id: string;
  name: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Totals {
  spend: number;
  purchases: number;
  link_clicks: number;
  impressions: number;
}

const SAMPLE_PROMPTS = [
  "Ano yung top 3 ads based on ROAS?",
  "Anong ads ang bleeding ng pera? Ano dapat i-kill?",
  "Compare performance ng top ad vs bottom ad — ano difference?",
  "Mag-summarize ka ng overall account health ngayon.",
];

type Tab = "chat" | "deconstruct";

export default function AiAnalyticsPage() {
  const [tab, setTab] = useState<Tab>("chat");

  // Data loading
  const [datePreset, setDatePreset] = useState<DatePreset>("last_7d");
  const [accountFilter, setAccountFilter] = useState("ALL");
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [ads, setAds] = useState<AdRow[]>([]);
  const [totals, setTotals] = useState<Totals>({
    spend: 0,
    purchases: 0,
    link_clicks: 0,
    impressions: 0,
  });
  const [loadingAds, setLoadingAds] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadAds() {
      setLoadingAds(true);
      setLoadError(null);
      try {
        const res = await fetch(
          `/api/facebook/all-ads?date_preset=${datePreset}&account=${accountFilter}`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load ads");
        setAds((json.data as AdRow[]) ?? []);
        setAccounts((json.accounts as AccountInfo[]) ?? []);
        if (json.totals) setTotals(json.totals as Totals);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load ads");
      } finally {
        setLoadingAds(false);
      }
    }
    loadAds();
  }, [datePreset, accountFilter]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // When filters change, clear the chat — otherwise the AI is answering against stale context
  useEffect(() => {
    setMessages([]);
    setChatError(null);
  }, [datePreset, accountFilter]);

  async function handleSend(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || streaming) return;
    if (ads.length === 0) {
      setChatError("No ads data loaded yet. Try refreshing.");
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);
    setChatError(null);

    // Start with an empty assistant message that we'll fill as we stream
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/marketing/ai-analytics/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          ads_snapshot: ads,
          date_preset: datePreset,
          totals,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Chat error (${res.status})`);
      }

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on double newlines (SSE event boundary)
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          for (const line of event.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (!payload || payload === "[DONE]") continue;
            try {
              const obj = JSON.parse(payload);
              if (
                obj.type === "content_block_delta" &&
                obj.delta?.type === "text_delta"
              ) {
                acc += obj.delta.text;
                setMessages((prev) => {
                  const copy = [...prev];
                  const last = copy[copy.length - 1];
                  if (last?.role === "assistant") {
                    copy[copy.length - 1] = { ...last, content: acc };
                  }
                  return copy;
                });
              }
            } catch {
              // ignore malformed event frames
            }
          }
        }
      }
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Chat failed");
      // Drop the empty assistant placeholder
      setMessages((prev) =>
        prev[prev.length - 1]?.role === "assistant" &&
        prev[prev.length - 1].content === ""
          ? prev.slice(0, -1)
          : prev
      );
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-emerald-600/20 rounded-lg">
          <BarChart3 size={20} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">AI Analytics</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Chat with your ads data. Powered by Claude Sonnet.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400">Date:</label>
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:ring-emerald-500 focus:border-emerald-500"
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400">Account:</label>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:ring-emerald-500 focus:border-emerald-500 max-w-[240px]"
          >
            <option value="ALL">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        {loadingAds ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <RefreshCw size={12} className="animate-spin" />
            Loading ads…
          </div>
        ) : (
          <div className="text-xs text-gray-500">
            {ads.length} ads · ₱{totals.spend.toFixed(0)} spend ·{" "}
            {totals.purchases} purchases
          </div>
        )}
      </div>

      {loadError && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {loadError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-800/50 border border-gray-700/50 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("chat")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === "chat"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-gray-300"
          }`}
        >
          <Sparkles size={14} /> Chat Insights
        </button>
        <button
          onClick={() => setTab("deconstruct")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === "deconstruct"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-gray-300"
          }`}
        >
          <Video size={14} /> Creative Deconstruction
        </button>
      </div>

      {/* Chat Tab */}
      {tab === "chat" && (
        <div className="bg-gray-900/50 border border-gray-700/50 rounded-xl overflow-hidden flex flex-col h-[65vh] min-h-[500px]">
          {/* Messages area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !streaming && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Sparkles size={28} className="text-emerald-400/60 mb-3" />
                <p className="text-gray-400 text-sm mb-1">
                  Ask me anything about your ads.
                </p>
                <p className="text-gray-500 text-xs mb-6">
                  I see {ads.length} ads from {accounts.length || "your"}{" "}
                  account(s) for the selected date range.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 w-full max-w-xl">
                  {SAMPLE_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => handleSend(p)}
                      disabled={loadingAds || ads.length === 0}
                      className="text-left text-xs text-gray-300 bg-gray-800/70 hover:bg-gray-700/70 border border-gray-700 rounded-lg px-3 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-emerald-600 text-white"
                      : "bg-gray-800 text-gray-200 border border-gray-700"
                  }`}
                >
                  {m.content ||
                    (streaming && i === messages.length - 1 ? (
                      <Loader2 size={14} className="animate-spin text-gray-400" />
                    ) : (
                      ""
                    ))}
                </div>
              </div>
            ))}

            {chatError && (
              <div className="flex justify-start">
                <div className="bg-red-900/30 border border-red-700/50 text-red-300 text-sm rounded-2xl px-4 py-2.5 flex items-center gap-2">
                  <AlertCircle size={14} />
                  {chatError}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-gray-700/50 p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-end gap-2"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  loadingAds
                    ? "Loading ads…"
                    : ads.length === 0
                      ? "No ads data yet"
                      : "Ask about your ads… (Enter to send, Shift+Enter for newline)"
                }
                disabled={loadingAds || streaming || ads.length === 0}
                rows={2}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:ring-emerald-500 focus:border-emerald-500 resize-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={
                  loadingAds || streaming || !input.trim() || ads.length === 0
                }
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {streaming ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Deconstruct Tab — Phase 2 placeholder */}
      {tab === "deconstruct" && (
        <div className="bg-gray-900/50 border border-gray-700/50 rounded-xl p-12 text-center">
          <Video size={40} className="text-gray-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-white mb-1">
            Creative Deconstruction
          </h3>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            Coming in Phase 2 — AI watches your top ad videos, extracts scripts,
            identifies hooks, maps scene changes, and describes visual style.
          </p>
          <p className="text-gray-500 text-xs mt-4">
            Set your Gemini API key in Admin → Settings to prepare.
          </p>
        </div>
      )}
    </div>
  );
}
