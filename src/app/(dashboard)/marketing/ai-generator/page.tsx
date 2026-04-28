"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Sparkles,
  Send,
  RefreshCw,
  Copy,
  AlertTriangle,
  Trash2,
  MessageSquare,
  Plus,
  CheckCircle,
  Library,
  MessageCircle,
} from "lucide-react";
import type { AiStoreDoc } from "@/lib/ai/types";
import { DOC_TYPES, SYSTEM_PROMPT_TYPES } from "@/lib/ai/types";
import {
  AssistantMessageRenderer,
  scriptKey,
} from "@/components/marketing/assistant-message-renderer";
import { ApprovedLibrary } from "@/components/marketing/approved-library";
import type { ApprovedScript } from "@/lib/ai/approved-scripts-types";

interface Message {
  role: "user" | "assistant";
  content: string;
  // Structured tool_use payload from the generator. Present on assistant
  // turns produced by /api/ai/generate after the v2 tool-use rollout.
  // null on user turns and on legacy/fallback assistant turns.
  structured?: Record<string, unknown> | null;
  validation?: {
    ok: boolean;
    enforced: boolean;
    reasons: string[];
    retried: boolean;
  } | null;
}

interface Thread {
  id: string;
  store_name: string;
  tool_type: string;
  created_at: string;
  preview: string; // first user message
  messages: Message[];
}

type View = "chat" | "library";

// Module-level cache — survives navigation
let cachedMessages: Message[] = [];
let cachedThreadId: string | null = null;
let cachedToolType: "angles" | "scripts" | "formats" = "angles";
let cachedStoreName = "";
let cachedView: View = "chat";

export default function AiGeneratorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [stores, setStores] = useState<{ name: string }[]>([]);
  const [storeName, setStoreName] = useState(cachedStoreName);
  const [docs, setDocs] = useState<AiStoreDoc[]>([]);
  const [docsReady, setDocsReady] = useState(0);
  const [loading, setLoading] = useState(true);

  // View mode: chat (generate) or library (approved scripts)
  const [view, setView] = useState<View>(cachedView);

  // Chat
  const [toolType, setToolType] = useState<"angles" | "scripts" | "formats">(cachedToolType);
  const [messages, setMessages] = useState<Message[]>(cachedMessages);
  const [threadId, setThreadId] = useState<string | null>(cachedThreadId);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  // Thread history
  const [threads, setThreads] = useState<Thread[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Approved scripts for the currently-loaded thread — keyed by scriptKey()
  const [approvals, setApprovals] = useState<Map<string, ApprovedScript>>(
    new Map()
  );

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const totalRequired = DOC_TYPES.length + SYSTEM_PROMPT_TYPES.length;

  // Persist to module cache on change
  useEffect(() => {
    cachedMessages = messages;
    cachedThreadId = threadId;
    cachedToolType = toolType;
    cachedStoreName = storeName;
    cachedView = view;
  }, [messages, threadId, toolType, storeName, view]);

  // Load existing approvals for the current thread so already-approved scripts
  // show as "Approved" when the user returns to a past conversation.
  useEffect(() => {
    if (!threadId || !storeName) {
      setApprovals(new Map());
      return;
    }
    fetch(`/api/ai/approved-scripts?store=${encodeURIComponent(storeName)}`)
      .then((r) => r.json())
      .then((json) => {
        const next = new Map<string, ApprovedScript>();
        for (const s of (json.scripts || []) as ApprovedScript[]) {
          if (s.source_thread_id !== threadId) continue;
          next.set(scriptKey(s.script_number, s.angle_title), s);
        }
        setApprovals(next);
      })
      .catch(() => {});
  }, [threadId, storeName]);

  // Fetch stores
  useEffect(() => {
    fetch("/api/shopify/stores")
      .then((r) => r.json())
      .then((json) => {
        const storeList = (json.stores || json || []).map((s: { name: string }) => ({ name: s.name }));
        setStores(storeList);
        if (storeList.length > 0 && !storeName) {
          setStoreName(storeList[0].name);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Handoff from Comparative Report (or anywhere): consume URL params
  // ?store=...&tool=angles|scripts|formats&prompt=...
  // ?winner_analysis_id=<uuid> for Expand-from-Winner — pre-loads the
  // winner's DNA report as a hidden seed message, switches store + tool,
  // and starts a new thread.
  // Strips params from the URL after consuming so refresh doesn't re-trigger.
  useEffect(() => {
    const storeParam = searchParams.get("store");
    const toolParam = searchParams.get("tool");
    const promptParam = searchParams.get("prompt");
    const winnerIdParam = searchParams.get("winner_analysis_id");
    if (!storeParam && !toolParam && !promptParam && !winnerIdParam) return;

    if (toolParam === "angles" || toolParam === "scripts" || toolParam === "formats") {
      setToolType(toolParam);
    }
    if (storeParam) setStoreName(storeParam);
    if (promptParam) setInput(promptParam);

    if (winnerIdParam) {
      // Fetch the winner's DNA report and pre-load it as message[0] so the
      // generator has the full structural context before the user types.
      fetch(`/api/ai/winner-context?id=${encodeURIComponent(winnerIdParam)}`)
        .then((r) => r.json())
        .then((json) => {
          if (!json.seed_user_message) return;
          if (json.store_name) setStoreName(json.store_name);
          setMessages([
            { role: "user", content: json.seed_user_message },
          ]);
          setThreadId(null);
          if (!json.has_v2) {
            setError(
              "This winner was deconstructed before v2.0 — re-run the deconstruction from the Compare flow to enable full expansion."
            );
          }
        })
        .catch(() => {
          setError("Failed to load winner context.");
        });
    }

    router.replace("/marketing/ai-generator");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch docs when store changes
  useEffect(() => {
    if (!storeName) return;
    const allTypes = [...DOC_TYPES, ...SYSTEM_PROMPT_TYPES];
    fetch(`/api/ai/docs?store=${encodeURIComponent(storeName)}`)
      .then((r) => r.json())
      .then((json) => {
        const storeDocs = json.docs || [];
        setDocs(storeDocs);
        const filled = allTypes.filter((dt) =>
          storeDocs.some((d: AiStoreDoc) => d.doc_type === dt.key)
        ).length;
        setDocsReady(filled);
      })
      .catch(() => setDocsReady(0));
  }, [storeName]);

  // Fetch thread history
  useEffect(() => {
    fetch("/api/ai/history?limit=20")
      .then((r) => r.json())
      .then((json) => {
        const items = (json.data || json.history || []).map((h: Record<string, unknown>) => ({
          id: h.id,
          store_name: h.store_name,
          tool_type: h.tool_type,
          created_at: h.created_at,
          preview: ((h.input_data as Record<string, unknown>)?.messages as Message[])?.[0]?.content?.slice(0, 60) || "...",
          messages: ((h.input_data as Record<string, unknown>)?.messages as Message[]) || [],
        }));
        setThreads(items);
      })
      .catch(() => {});
  }, []);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, generating]);

  // Auto-save thread after each AI response. We persist the most recent
  // structured payload separately so the renderer can re-hydrate typed
  // cards on thread reload — the legacy `messages` array keeps the
  // markdown text for backward compat with old threads.
  const autoSave = useCallback(async (msgs: Message[]) => {
    try {
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      const body: Record<string, unknown> = {
        store_name: storeName,
        tool_type: toolType,
        input_data: { messages: msgs },
        output_data: { messages: msgs },
      };
      if (lastAssistant?.structured) {
        body.structured_output = lastAssistant.structured;
      }
      if (threadId) body.id = threadId;

      const res = await fetch("/api/ai/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.id && !threadId) {
        setThreadId(json.id);
      }
    } catch {}
  }, [storeName, toolType, threadId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || generating) return;

    setError(null);
    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setGenerating(true);

    try {
      // Strip client-only fields (structured, validation) before sending to
      // the API — Anthropic only accepts {role, content} strings here.
      const wireMessages = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: storeName,
          tool_type: toolType,
          messages: wireMessages,
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
        {
          role: "assistant",
          content: json.text,
          structured: json.structured ?? null,
          validation: json.validation ?? null,
        },
      ];
      setMessages(fullMessages);

      // Auto-save
      autoSave(fullMessages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, messages, generating, storeName, toolType, autoSave]);

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

  const handleScriptApproved = (s: ApprovedScript) => {
    setApprovals((prev) => {
      const next = new Map(prev);
      next.set(scriptKey(s.script_number, s.angle_title), s);
      return next;
    });
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
    setToolType((thread.tool_type as "angles" | "scripts" | "formats") || "angles");
    setShowHistory(false);
    setError(null);
  };

  const notReady = docsReady < totalRequired;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-600/20 rounded-lg">
            <Sparkles size={20} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">AI Generator</h1>
            <p className="text-gray-400 text-sm">Chat with AI using your store&apos;s knowledge</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {view === "chat" && (
            <>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                  showHistory ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
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
            onChange={(e) => { setStoreName(e.target.value); handleNewThread(); }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {stores.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* View tabs (sub-tab inside AI Generator) */}
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

      {/* Readiness — only relevant when chatting */}
      {view === "chat" && (
        docsReady >= totalRequired ? (
          <div className="mb-2 p-2 bg-green-900/20 border border-green-700/50 rounded-lg text-green-300 text-xs flex items-center gap-2">
            <CheckCircle size={14} />
            {totalRequired}/{totalRequired} docs ready
          </div>
        ) : (
          <div className="mb-2 p-2 bg-yellow-900/20 border border-yellow-700/50 rounded-lg text-yellow-300 text-xs flex items-center gap-2">
            <AlertTriangle size={14} />
            {docsReady}/{totalRequired} docs ready —{" "}
            <a href="/marketing/ai-settings" className="underline">Fill missing docs</a>
          </div>
        )
      )}

      {/* Tool selector (chat only) */}
      {view === "chat" && (
        <div className="flex items-center gap-2 mb-3">
          {([
            { value: "angles", label: "Angle Generator" },
            { value: "scripts", label: "Script Creator" },
            { value: "formats", label: "Format Expansion" },
          ] as const).map((t) => (
            <button
              key={t.value}
              onClick={() => { setToolType(t.value); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                toolType === t.value
                  ? "bg-emerald-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Main area */}
      {view === "library" ? (
        <div className="flex-1 overflow-hidden">
          <ApprovedLibrary storeName={storeName} />
        </div>
      ) : (
      <div className="flex-1 flex gap-3 overflow-hidden">
        {/* Thread history sidebar */}
        {showHistory && (
          <div className="w-64 bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-y-auto flex-shrink-0">
            <div className="p-3 border-b border-gray-700/50">
              <p className="text-xs font-medium text-gray-400 uppercase">Recent Threads</p>
            </div>
            <div className="p-2 space-y-1">
              {threads.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-4">No history yet</p>
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
                    {t.store_name} · {new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat area */}
        <div className="flex-1 bg-gray-800/30 border border-gray-700/50 rounded-xl overflow-hidden flex flex-col">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <Sparkles size={40} className="text-gray-600 mb-4" />
                <p className="text-gray-400 text-lg font-medium mb-2">Start a conversation</p>
                <p className="text-gray-500 text-sm max-w-md">
                  Chat with AI about <strong className="text-gray-300">{storeName}</strong>.
                  Using <strong className="text-emerald-400">{toolType === "angles" ? "Angle Generator" : toolType === "scripts" ? "Script Creator" : "Format Expansion"}</strong> system prompt.
                </p>
                <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-lg">
                  {[
                    "Generate 7 unique ad angles",
                    "Write a 60-second video script",
                    "Create 5 hook variations",
                    "Expand this winning angle into 3 formats",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => { setInput(suggestion); setTimeout(() => inputRef.current?.focus(), 50); }}
                      disabled={notReady}
                      className="text-xs bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start flex-col items-start gap-2">
                  {msg.validation && msg.validation.enforced && !msg.validation.ok && (
                    <div className="max-w-[85%] p-2 bg-yellow-900/20 border border-yellow-700/50 rounded-lg text-yellow-300 text-xs flex items-start gap-2">
                      <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                      <div>
                        <strong>Variation gate flagged this batch{msg.validation.retried ? " (after one auto-retry)" : ""}.</strong>
                        <ul className="list-disc list-inside mt-1 space-y-0.5">
                          {msg.validation.reasons.map((r, ri) => (
                            <li key={ri}>{r}</li>
                          ))}
                        </ul>
                        <p className="mt-1 text-yellow-400/80">Review before approving — outputs may be too similar.</p>
                      </div>
                    </div>
                  )}
                  <div
                    className={`${
                      toolType === "scripts" ? "w-full" : "max-w-[85%]"
                    } rounded-xl px-4 py-3 bg-gray-700/30 border border-gray-600/50 text-gray-200`}
                  >
                    <AssistantMessageRenderer
                      content={msg.content}
                      toolType={toolType}
                      storeName={storeName}
                      threadId={threadId}
                      messageIndex={i}
                      existingApprovals={approvals}
                      onApproved={handleScriptApproved}
                      structured={msg.structured ?? null}
                    />
                  </div>
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
              <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">{error}</div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Actions bar */}
          {messages.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-700/50 flex items-center gap-3">
              <button onClick={handleCopyAll} className="text-xs text-gray-500 hover:text-white flex items-center gap-1 cursor-pointer">
                {copiedAll ? (
                  <>
                    <CheckCircle size={12} className="text-green-400" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy size={12} /> Copy All
                  </>
                )}
              </button>
              <button onClick={handleNewThread} className="text-xs text-gray-500 hover:text-red-400 flex items-center gap-1 cursor-pointer ml-auto">
                <Trash2 size={12} /> Clear
              </button>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t border-gray-700/50">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={notReady ? "Fill all knowledge docs first..." : `Message AI about ${storeName}...`}
                disabled={notReady || generating}
                rows={2}
                className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || generating || notReady}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center"
              >
                {generating ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-1.5">
              Enter to send · Shift+Enter for new line · Auto-saves after each response
            </p>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
