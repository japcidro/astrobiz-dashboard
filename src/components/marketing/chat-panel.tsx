"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Send,
  Loader2,
  AlertCircle,
  History,
  Plus,
  Trash2,
} from "lucide-react";

export interface ChatAd {
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

export interface ChatTotals {
  spend: number;
  purchases: number;
  link_clicks: number;
  impressions: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface SessionSummary {
  id: string;
  title: string;
  account_id: string | null;
  date_preset: string | null;
  updated_at: string;
  message_count: number;
}

interface Props {
  ads: ChatAd[];
  totals: ChatTotals;
  datePreset: string;
  accountFilter: string;
  accountCount: number;
  loadingAds: boolean;
}

const SAMPLE_PROMPTS = [
  "Ano yung top 3 ads based on ROAS?",
  "Anong ads ang bleeding ng pera? Ano dapat i-kill?",
  "Compare performance ng top ad vs bottom ad — ano difference?",
  "Mag-summarize ka ng overall account health ngayon.",
];

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function ChatPanel({
  ads,
  totals,
  datePreset,
  accountFilter,
  accountCount,
  loadingAds,
}: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/ai-analytics/sessions");
      const json = await res.json();
      if (res.ok) setSessions((json.rows as SessionSummary[]) ?? []);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // Close history dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        historyRef.current &&
        !historyRef.current.contains(e.target as Node)
      ) {
        setHistoryOpen(false);
      }
    }
    if (historyOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [historyOpen]);

  async function saveSession(next: ChatMessage[]) {
    try {
      const res = await fetch("/api/marketing/ai-analytics/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sessionId,
          messages: next,
          account_id: accountFilter,
          date_preset: datePreset,
        }),
      });
      const json = await res.json();
      if (res.ok && json.row?.id) {
        setSessionId(json.row.id as string);
        // Refresh sessions list so the sidebar reflects the new entry.
        void loadSessions();
      }
    } catch {
      // Non-fatal; user can still chat.
    }
  }

  async function loadSession(id: string) {
    setHistoryOpen(false);
    setLoadingSession(true);
    try {
      const res = await fetch(`/api/marketing/ai-analytics/sessions/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      const row = json.row as {
        id: string;
        messages: ChatMessage[];
      };
      setSessionId(row.id);
      setMessages(row.messages ?? []);
      setChatError(null);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Failed to load session");
    } finally {
      setLoadingSession(false);
    }
  }

  async function deleteSession(id: string) {
    try {
      const res = await fetch(`/api/marketing/ai-analytics/sessions/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (sessionId === id) {
          setSessionId(null);
          setMessages([]);
        }
      }
    } catch {
      // ignore
    }
  }

  function newChat() {
    setHistoryOpen(false);
    setSessionId(null);
    setMessages([]);
    setChatError(null);
    setInput("");
  }

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

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    let acc = "";
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

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

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

      // Persist after stream completes
      if (acc.trim()) {
        void saveSession([...nextMessages, { role: "assistant", content: acc }]);
      }
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Chat failed");
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
    <div className="bg-gray-900/50 border border-gray-700/50 rounded-xl overflow-hidden flex flex-col h-[65vh] min-h-[500px]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/50 bg-gray-800/30">
        <div className="text-xs text-gray-400">
          {sessionId ? "Continuing previous chat" : "New chat"}
        </div>
        <div className="flex items-center gap-1">
          <div className="relative" ref={historyRef}>
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              className="flex items-center gap-1 text-xs text-gray-300 hover:text-white px-2 py-1 rounded-md hover:bg-gray-700/50 cursor-pointer"
            >
              <History size={12} />
              History ({sessions.length})
            </button>
            {historyOpen && (
              <div className="absolute right-0 top-full mt-1 w-[320px] max-h-[360px] overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20">
                {sessions.length === 0 ? (
                  <div className="p-4 text-center text-xs text-gray-500">
                    No saved chats yet.
                  </div>
                ) : (
                  <div className="py-1">
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        className={`group flex items-center gap-2 px-3 py-2 hover:bg-gray-700/50 cursor-pointer ${
                          s.id === sessionId ? "bg-gray-700/40" : ""
                        }`}
                        onClick={() => loadSession(s.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-200 truncate">
                            {s.title}
                          </p>
                          <p className="text-[10px] text-gray-500">
                            {s.message_count} msg · {formatRelative(s.updated_at)}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              window.confirm(
                                "Delete this chat? This cannot be undone."
                              )
                            ) {
                              deleteSession(s.id);
                            }
                          }}
                          title="Delete"
                          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity flex-shrink-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={newChat}
            disabled={messages.length === 0 && !sessionId}
            className="flex items-center gap-1 text-xs text-gray-300 hover:text-white px-2 py-1 rounded-md hover:bg-gray-700/50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={12} />
            New chat
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loadingSession && (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={16} className="animate-spin text-gray-500" />
          </div>
        )}

        {!loadingSession && messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Sparkles size={28} className="text-emerald-400/60 mb-3" />
            <p className="text-gray-400 text-sm mb-1">
              Ask me anything about your ads.
            </p>
            <p className="text-gray-500 text-xs mb-6">
              I see {ads.length} ads from {accountCount || "your"} account(s)
              for the selected date range.
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

      {/* Input */}
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
  );
}
