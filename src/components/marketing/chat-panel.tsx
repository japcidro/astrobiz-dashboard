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
  Wrench,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Kept exported for any legacy importer; no longer consumed by ChatPanel
// since the agent pulls live data via tools instead of receiving snapshots.
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

interface ToolCallChip {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "running" | "ok" | "error";
  duration_ms?: number;
  result_rows?: number;
  error_message?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  // Tool calls made while producing THIS assistant message. Only
  // populated on assistant turns.
  tool_calls?: ToolCallChip[];
}

interface SessionSummary {
  id: string;
  title: string;
  date_preset: string | null;
  updated_at: string;
  message_count: number;
}

const SAMPLE_PROMPTS = [
  "Ano yung top 3 ads ko ngayong week based on ROAS?",
  "Anong ads ang bleeding? Ano dapat i-pause?",
  "I-summarize mo yung pinaka-recent comparative analysis ko.",
  "May mga na-deconstruct na ba akong ads last 30 days? Ano yung common hooks?",
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

export function ChatPanel() {
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
        }),
      });
      const json = await res.json();
      if (res.ok && json.row?.id) {
        setSessionId(json.row.id as string);
        void loadSessions();
      }
    } catch {
      // non-fatal — user can still chat.
    }
  }

  async function loadSession(id: string) {
    setHistoryOpen(false);
    setLoadingSession(true);
    try {
      const res = await fetch(`/api/marketing/ai-analytics/sessions/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      const row = json.row as { id: string; messages: ChatMessage[] };
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

    const userMsg: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);
    setChatError(null);

    // Placeholder assistant message — we'll fill content + tool_calls as
    // events stream in.
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", tool_calls: [] },
    ]);

    function updateLastAssistant(
      patch: (m: ChatMessage) => ChatMessage | void
    ) {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role !== "assistant") return prev;
        const updated = patch({ ...last });
        if (updated) copy[copy.length - 1] = updated;
        else copy[copy.length - 1] = last;
        return copy;
      });
    }

    let accText = "";
    const liveToolCalls: ToolCallChip[] = [];

    try {
      const res = await fetch("/api/marketing/ai-analytics/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          session_id: sessionId,
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
          let eventType = "message";
          let payload = "";
          for (const line of event.split("\n")) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) payload = line.slice(6);
          }
          if (!payload || payload === "[DONE]") continue;
          let obj: Record<string, unknown>;
          try {
            obj = JSON.parse(payload);
          } catch {
            continue;
          }

          if (eventType === "tool_call") {
            const chip: ToolCallChip = {
              id: obj.id as string,
              name: obj.name as string,
              input: (obj.input as Record<string, unknown>) ?? {},
              status: "running",
            };
            liveToolCalls.push(chip);
            updateLastAssistant((m) => {
              m.tool_calls = [...liveToolCalls];
              return m;
            });
          } else if (eventType === "tool_result") {
            const idx = liveToolCalls.findIndex((c) => c.id === obj.id);
            if (idx >= 0) {
              liveToolCalls[idx] = {
                ...liveToolCalls[idx],
                status: obj.status === "ok" ? "ok" : "error",
                duration_ms: obj.duration_ms as number | undefined,
                result_rows: obj.result_rows as number | undefined,
                error_message: obj.error_message as string | undefined,
              };
              updateLastAssistant((m) => {
                m.tool_calls = [...liveToolCalls];
                return m;
              });
            }
          } else if (eventType === "content_block_delta") {
            const delta = obj.delta as
              | { type: string; text?: string }
              | undefined;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
              accText += delta.text;
              updateLastAssistant((m) => {
                m.content = accText;
                return m;
              });
            }
          } else if (eventType === "cost_cap") {
            setChatError(
              (obj.message as string) ??
                "Session cost cap reached — mag-new chat ka."
            );
          } else if (eventType === "error") {
            throw new Error(
              (obj.message as string) ?? "Agent error"
            );
          } else if (eventType === "done") {
            const finalText = obj.final_text as string | undefined;
            if (finalText && !accText) {
              accText = finalText;
              updateLastAssistant((m) => {
                m.content = finalText;
                return m;
              });
            }
          }
        }
      }

      // Persist after stream completes
      if (accText.trim()) {
        const finalMessages: ChatMessage[] = [
          ...nextMessages,
          {
            role: "assistant",
            content: accText,
            tool_calls: liveToolCalls.length > 0 ? liveToolCalls : undefined,
          },
        ];
        void saveSession(finalMessages);
      }
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Chat failed");
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.content === "") {
          return prev.slice(0, -1);
        }
        return prev;
      });
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
                            {s.message_count} msg ·{" "}
                            {formatRelative(s.updated_at)}
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
              I can pull live FB performance, past deconstructions, comparative
              reports, scaling campaigns, and autopilot activity.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 w-full max-w-xl">
              {SAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => handleSend(p)}
                  disabled={streaming}
                  className="text-left text-xs text-gray-300 bg-gray-800/70 hover:bg-gray-700/70 border border-gray-700 rounded-lg px-3 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const isLastAssistant =
            m.role === "assistant" && i === messages.length - 1;
          const showSpinner = streaming && isLastAssistant && !m.content;
          return (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] space-y-2 ${
                  m.role === "user" ? "" : "w-full"
                }`}
              >
                {m.role === "assistant" &&
                  m.tool_calls &&
                  m.tool_calls.length > 0 && (
                    <ToolCallChips
                      chips={m.tool_calls}
                      streaming={streaming && isLastAssistant}
                    />
                  )}
                {(m.content || showSpinner) && (
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm ${
                      m.role === "user"
                        ? "bg-emerald-600 text-white whitespace-pre-wrap"
                        : "bg-gray-800 text-gray-200 border border-gray-700"
                    }`}
                  >
                    {m.role === "assistant" && m.content ? (
                      <AssistantMarkdown content={m.content} />
                    ) : m.content ? (
                      m.content
                    ) : showSpinner ? (
                      <Loader2
                        size={14}
                        className="animate-spin text-gray-400"
                      />
                    ) : (
                      ""
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

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
              streaming
                ? "AI is working…"
                : "Ask about your ads… (Enter to send, Shift+Enter for newline)"
            }
            disabled={streaming}
            rows={2}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:ring-emerald-500 focus:border-emerald-500 resize-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
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

// ── Assistant markdown ────────────────────────────────────────────
// Minimal markdown renderer for assistant replies — GFM tables are the
// main reason we pulled in react-markdown (tables rendered as raw pipes
// before). Tailwind-styled elements keep rendering consistent with the
// rest of the dashboard's dark UI.
function AssistantMarkdown({ content }: { content: string }) {
  // Tailwind v4; @tailwindcss/typography isn't installed, so we hand-style
  // every markdown element via components overrides.
  return (
    <div className="space-y-1.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="my-1.5 leading-relaxed">{children}</p>
          ),
          h1: ({ children }) => (
            <h1 className="text-base font-bold mt-3 mb-1.5 text-white">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-bold mt-3 mb-1.5 text-white">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold mt-2.5 mb-1 text-white">
              {children}
            </h3>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-white">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="border-collapse border border-gray-700 text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-gray-900/70">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-gray-700 px-2 py-1 text-left font-semibold text-gray-200">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-700 px-2 py-1 text-gray-300">
              {children}
            </td>
          ),
          code: ({ children, className }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <pre className="bg-gray-900/70 border border-gray-700 rounded p-2 overflow-x-auto text-[11px]">
                  <code>{children}</code>
                </pre>
              );
            }
            return (
              <code className="bg-gray-900/70 px-1 py-0.5 rounded text-[0.9em] font-mono">
                {children}
              </code>
            );
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 underline hover:text-emerald-300"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-gray-600 pl-3 my-2 text-gray-400 italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-gray-700 my-3" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ── Tool call chips ────────────────────────────────────────────────
// Renders the live "AI is querying X…" indicator plus the collapsible
// "Data used" section underneath each assistant message.
function ToolCallChips({
  chips,
  streaming,
}: {
  chips: ToolCallChip[];
  streaming: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const running = chips.find((c) => c.status === "running");

  return (
    <div className="space-y-1.5">
      {running && streaming && (
        <div className="inline-flex items-center gap-1.5 bg-blue-900/30 border border-blue-700/40 text-blue-300 text-[11px] rounded-full px-2.5 py-1">
          <Loader2 size={10} className="animate-spin" />
          <span>
            AI is querying <span className="font-mono">{running.name}</span>…
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const isExpanded = expandedId === c.id;
          const Icon =
            c.status === "running"
              ? Loader2
              : c.status === "ok"
                ? CheckCircle2
                : XCircle;
          const color =
            c.status === "running"
              ? "text-blue-300 border-blue-700/40 bg-blue-900/20"
              : c.status === "ok"
                ? "text-emerald-300 border-emerald-700/40 bg-emerald-900/20"
                : "text-red-300 border-red-700/40 bg-red-900/20";
          return (
            <div key={c.id} className="w-full">
              <button
                onClick={() => setExpandedId(isExpanded ? null : c.id)}
                className={`w-full flex items-center gap-1.5 text-[11px] border rounded-md px-2 py-1 transition-colors hover:brightness-110 cursor-pointer ${color}`}
              >
                {isExpanded ? (
                  <ChevronDown size={11} />
                ) : (
                  <ChevronRight size={11} />
                )}
                <Wrench size={10} />
                <span className="font-mono font-medium">{c.name}</span>
                {c.result_rows !== undefined && (
                  <span className="opacity-70">· {c.result_rows} rows</span>
                )}
                {c.duration_ms !== undefined && (
                  <span className="opacity-70">
                    · {(c.duration_ms / 1000).toFixed(1)}s
                  </span>
                )}
                <Icon
                  size={11}
                  className={`ml-auto ${c.status === "running" ? "animate-spin" : ""}`}
                />
              </button>
              {isExpanded && (
                <div className="mt-1 ml-4 p-2 bg-gray-900/60 border border-gray-700/50 rounded text-[11px] text-gray-300 font-mono">
                  <div className="text-gray-500 mb-0.5">Input:</div>
                  <pre className="whitespace-pre-wrap break-all">
                    {Object.keys(c.input).length > 0
                      ? JSON.stringify(c.input, null, 2)
                      : "(no arguments)"}
                  </pre>
                  {c.error_message && (
                    <>
                      <div className="text-red-400 mt-1.5 mb-0.5">Error:</div>
                      <pre className="whitespace-pre-wrap break-all text-red-300">
                        {c.error_message}
                      </pre>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
