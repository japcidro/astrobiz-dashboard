"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Sparkles,
  Send,
  RefreshCw,
  Copy,
  Trash2,
  MessageSquare,
  Plus,
  CheckCircle,
  Library,
  MessageCircle,
  BookmarkPlus,
  AlertCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrandFilesPanel } from "@/components/marketing/brand-files-panel";
import { BrandSystemPromptEditor } from "@/components/marketing/brand-system-prompt-editor";
import { SaveScriptModal } from "@/components/marketing/save-script-modal";
import { ApprovedLibrary } from "@/components/marketing/approved-library";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Thread {
  id: string;
  store_name: string;
  created_at: string;
  preview: string;
  messages: Message[];
}

type View = "chat" | "library";

// Module-level cache — survives navigation within the SPA session.
let cachedMessages: Message[] = [];
let cachedThreadId: string | null = null;
let cachedStoreName = "";
let cachedView: View = "chat";

export default function AiGeneratorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [stores, setStores] = useState<{ name: string }[]>([]);
  const [storeName, setStoreName] = useState(cachedStoreName);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<View>(cachedView);
  const [messages, setMessages] = useState<Message[]>(cachedMessages);
  const [threadId, setThreadId] = useState<string | null>(cachedThreadId);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [saveIndex, setSaveIndex] = useState<number | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persist key state to module cache so navigating away/back keeps the convo.
  useEffect(() => {
    cachedMessages = messages;
    cachedThreadId = threadId;
    cachedStoreName = storeName;
    cachedView = view;
  }, [messages, threadId, storeName, view]);

  // Load stores
  useEffect(() => {
    fetch("/api/shopify/stores")
      .then((r) => r.json())
      .then((json) => {
        const storeList = (json.stores || json || []).map(
          (s: { name: string }) => ({ name: s.name })
        );
        setStores(storeList);
        if (storeList.length > 0 && !storeName) {
          setStoreName(storeList[0].name);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL handoff — ?store=...&prompt=... (used by other pages to deep-link
  // into a pre-loaded conversation starter).
  useEffect(() => {
    const storeParam = searchParams.get("store");
    const promptParam = searchParams.get("prompt");
    if (!storeParam && !promptParam) return;
    if (storeParam) setStoreName(storeParam);
    if (promptParam) setInput(promptParam);
    router.replace("/marketing/ai-generator");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Thread history for the right rail
  const loadThreads = useCallback(() => {
    const qs = storeName ? `?store=${encodeURIComponent(storeName)}` : "";
    fetch(`/api/ai/history${qs}`)
      .then((r) => r.json())
      .then((json) => {
        const items = (json.history || []).map(
          (h: Record<string, unknown>) => ({
            id: h.id as string,
            store_name: h.store_name as string,
            created_at: h.created_at as string,
            preview:
              (
                (h.input_data as Record<string, unknown>)?.messages as
                  | Message[]
                  | undefined
              )?.[0]?.content?.slice(0, 60) || "...",
            messages:
              ((h.input_data as Record<string, unknown>)?.messages as
                | Message[]
                | undefined) || [],
          })
        );
        setThreads(items);
      })
      .catch(() => {});
  }, [storeName]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, generating]);

  const autoSave = useCallback(
    async (msgs: Message[]) => {
      try {
        const body: Record<string, unknown> = {
          store_name: storeName,
          tool_type: "chat",
          input_data: { messages: msgs },
          output_data: { messages: msgs },
        };
        if (threadId) body.id = threadId;
        const res = await fetch("/api/ai/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (json.id && !threadId) setThreadId(json.id);
        loadThreads();
      } catch {}
    },
    [storeName, threadId, loadThreads]
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || generating || !storeName) return;

    setError(null);
    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(newMessages);
    setInput("");
    setGenerating(true);

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: storeName,
          messages: newMessages,
        }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Server error (${res.status})`);
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");

      const fullMessages: Message[] = [
        ...newMessages,
        { role: "assistant", content: json.text },
      ];
      setMessages(fullMessages);
      autoSave(fullMessages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, messages, generating, storeName, autoSave]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyAll = () => {
    const text = messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join("\n\n---\n\n");
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleNewThread = () => {
    setMessages([]);
    setThreadId(null);
    setError(null);
  };

  const handleLoadThread = (thread: Thread) => {
    setMessages(thread.messages);
    setThreadId(thread.id);
    setStoreName(thread.store_name);
    setShowHistory(false);
    setError(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-600/20 rounded-lg">
            <Sparkles size={20} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">AI Generator</h1>
            <p className="text-gray-400 text-sm">
              Drop your brand&apos;s reference files and chat — the AI adapts
              scripts using your tone and winning patterns.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {view === "chat" && (
            <>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                  showHistory
                    ? "bg-emerald-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                <MessageSquare size={14} />
                History
              </button>
              <button
                onClick={handleNewThread}
                className="flex items-center gap-1.5 bg-gray-800 text-gray-400 hover:text-white px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer"
              >
                <Plus size={14} />
                New Chat
              </button>
            </>
          )}
          <select
            value={storeName}
            onChange={(e) => {
              setStoreName(e.target.value);
              handleNewThread();
            }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {stores.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-3 border-b border-gray-800">
        <button
          onClick={() => setView("chat")}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
            view === "chat"
              ? "border-emerald-500 text-white"
              : "border-transparent text-gray-500 hover:text-white"
          }`}
        >
          <MessageCircle size={14} />
          Chat
        </button>
        <button
          onClick={() => setView("library")}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
            view === "library"
              ? "border-emerald-500 text-white"
              : "border-transparent text-gray-500 hover:text-white"
          }`}
        >
          <Library size={14} />
          Approved Library
        </button>
      </div>

      {view === "library" ? (
        <div className="flex-1 overflow-hidden">
          <ApprovedLibrary storeName={storeName} />
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-[260px_1fr_320px] gap-3 overflow-hidden">
          {storeName ? (
            <BrandFilesPanel storeName={storeName} />
          ) : (
            <div />
          )}

          <div className="flex flex-col gap-3 overflow-hidden">
            {showHistory && (
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl max-h-48 overflow-y-auto">
                <div className="p-2 border-b border-gray-700/50 sticky top-0 bg-gray-800/95 backdrop-blur">
                  <p className="text-xs font-medium text-gray-400 uppercase">
                    Recent Threads
                  </p>
                </div>
                <div className="p-2 space-y-1">
                  {threads.length === 0 && (
                    <p className="text-xs text-gray-500 text-center py-4">
                      No history yet
                    </p>
                  )}
                  {threads.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleLoadThread(t)}
                      className={`w-full text-left p-2 rounded-lg text-xs transition-colors cursor-pointer ${
                        threadId === t.id
                          ? "bg-emerald-600/20 text-white"
                          : "text-gray-400 hover:bg-gray-700/50 hover:text-white"
                      }`}
                    >
                      <p className="font-medium truncate">{t.preview}</p>
                      <p className="text-gray-500 mt-0.5">
                        {t.store_name} ·{" "}
                        {new Date(t.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 bg-gray-800/30 border border-gray-700/50 rounded-xl overflow-hidden flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <Sparkles size={40} className="text-gray-600 mb-4" />
                    <p className="text-gray-400 text-lg font-medium mb-2">
                      Start a conversation
                    </p>
                    <p className="text-gray-500 text-sm max-w-md">
                      Chat with AI about{" "}
                      <strong className="text-gray-300">{storeName}</strong>.
                      The AI uses your uploaded reference files and brand
                      system prompt as context.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-lg">
                      {[
                        "Adapt this winning script for our brand: [paste script]",
                        "Generate 5 hook variations for our hero product",
                        "Write a 60-second TikTok script using our brand voice",
                        "Turn this customer review into a UGC-style script",
                      ].map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => {
                            setInput(suggestion);
                            setTimeout(() => inputRef.current?.focus(), 50);
                          }}
                          className="text-xs bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors cursor-pointer text-left"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg, i) =>
                  msg.role === "user" ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] rounded-xl px-4 py-3 bg-emerald-600/20 border border-emerald-700/50 text-white">
                        <div className="whitespace-pre-wrap text-sm leading-relaxed">
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={i}
                      className="flex justify-start flex-col items-start gap-1.5"
                    >
                      <div className="w-full rounded-xl px-4 py-3 bg-gray-700/30 border border-gray-600/50 text-gray-200 text-sm leading-relaxed">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => (
                              <p className="mb-2 last:mb-0 whitespace-pre-wrap">
                                {children}
                              </p>
                            ),
                            h1: ({ children }) => (
                              <h1 className="text-base font-bold text-white mt-3 mb-1.5 first:mt-0">
                                {children}
                              </h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="text-sm font-bold text-white mt-3 mb-1.5 first:mt-0">
                                {children}
                              </h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="text-sm font-semibold text-white mt-2.5 mb-1 first:mt-0">
                                {children}
                              </h3>
                            ),
                            ul: ({ children }) => (
                              <ul className="list-disc pl-5 mb-2 space-y-0.5">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal pl-5 mb-2 space-y-0.5">
                                {children}
                              </ol>
                            ),
                            li: ({ children }) => <li>{children}</li>,
                            strong: ({ children }) => (
                              <strong className="text-white font-semibold">
                                {children}
                              </strong>
                            ),
                            em: ({ children }) => (
                              <em className="italic">{children}</em>
                            ),
                            code: ({ children }) => (
                              <code className="bg-gray-900/70 px-1.5 py-0.5 rounded text-emerald-300 text-[12px] font-mono">
                                {children}
                              </code>
                            ),
                            pre: ({ children }) => (
                              <pre className="bg-gray-900/70 p-3 rounded-lg overflow-x-auto text-[12px] font-mono my-2">
                                {children}
                              </pre>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="border-l-2 border-emerald-500/50 pl-3 my-2 text-gray-300 italic">
                                {children}
                              </blockquote>
                            ),
                            hr: () => (
                              <hr className="border-gray-700/50 my-3" />
                            ),
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                      <button
                        onClick={() => setSaveIndex(i)}
                        className="text-[11px] text-gray-500 hover:text-emerald-400 flex items-center gap-1 cursor-pointer pl-2"
                      >
                        <BookmarkPlus size={11} />
                        Save to Approved Library
                      </button>
                    </div>
                  )
                )}

                {generating && (
                  <div className="flex justify-start">
                    <div className="bg-gray-700/30 border border-gray-600/50 rounded-xl px-4 py-3">
                      <div className="flex items-center gap-2 text-gray-400 text-sm">
                        <RefreshCw size={14} className="animate-spin" />
                        Generating...
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-start gap-2">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {messages.length > 0 && (
                <div className="px-4 py-2 border-t border-gray-700/50 flex items-center gap-3">
                  <button
                    onClick={handleCopyAll}
                    className="text-xs text-gray-500 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    {copiedAll ? (
                      <>
                        <CheckCircle size={12} className="text-green-400" />{" "}
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy size={12} /> Copy All
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleNewThread}
                    className="text-xs text-gray-500 hover:text-red-400 flex items-center gap-1 cursor-pointer ml-auto"
                  >
                    <Trash2 size={12} /> Clear
                  </button>
                </div>
              )}

              <div className="p-4 border-t border-gray-700/50">
                <div className="flex gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message AI about ${storeName || "your brand"}...`}
                    disabled={generating || !storeName}
                    rows={2}
                    className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none disabled:opacity-50"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || generating || !storeName}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center"
                  >
                    {generating ? (
                      <RefreshCw size={18} className="animate-spin" />
                    ) : (
                      <Send size={18} />
                    )}
                  </button>
                </div>
                <p className="text-xs text-gray-600 mt-1.5">
                  Enter to send · Shift+Enter for new line · Auto-saves after
                  each response
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-y-auto">
            {storeName && <BrandSystemPromptEditor storeName={storeName} />}
          </div>
        </div>
      )}

      {saveIndex !== null && messages[saveIndex] && (
        <SaveScriptModal
          storeName={storeName}
          threadId={threadId}
          messageContent={messages[saveIndex].content}
          messageIndex={saveIndex}
          onClose={() => setSaveIndex(null)}
          onSaved={() => setSaveIndex(null)}
        />
      )}
    </div>
  );
}
