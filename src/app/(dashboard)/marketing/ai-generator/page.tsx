"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Sparkles,
  Send,
  RefreshCw,
  Copy,
  CheckCircle,
  AlertTriangle,
  Trash2,
  MessageSquare,
  Plus,
} from "lucide-react";
import type { AiStoreDoc } from "@/lib/ai/types";
import { DOC_TYPES, SYSTEM_PROMPT_TYPES } from "@/lib/ai/types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Thread {
  id: string;
  store_name: string;
  tool_type: string;
  created_at: string;
  preview: string; // first user message
  messages: Message[];
}

// Module-level cache — survives navigation
let cachedMessages: Message[] = [];
let cachedThreadId: string | null = null;
let cachedToolType: "angles" | "scripts" | "formats" = "angles";
let cachedStoreName = "";

export default function AiGeneratorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [stores, setStores] = useState<{ name: string }[]>([]);
  const [storeName, setStoreName] = useState(cachedStoreName);
  const [docs, setDocs] = useState<AiStoreDoc[]>([]);
  const [docsReady, setDocsReady] = useState(0);
  const [loading, setLoading] = useState(true);

  // Chat
  const [toolType, setToolType] = useState<"angles" | "scripts" | "formats">(cachedToolType);
  const [messages, setMessages] = useState<Message[]>(cachedMessages);
  const [threadId, setThreadId] = useState<string | null>(cachedThreadId);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Thread history
  const [threads, setThreads] = useState<Thread[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const totalRequired = DOC_TYPES.length + SYSTEM_PROMPT_TYPES.length;

  // Persist to module cache on change
  useEffect(() => {
    cachedMessages = messages;
    cachedThreadId = threadId;
    cachedToolType = toolType;
    cachedStoreName = storeName;
  }, [messages, threadId, toolType, storeName]);

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
  // Pre-fills the store, tool, and chat input. Does NOT auto-send so the
  // user can review the prompt first. Strips params from the URL after
  // consuming so refresh doesn't re-trigger.
  useEffect(() => {
    const storeParam = searchParams.get("store");
    const toolParam = searchParams.get("tool");
    const promptParam = searchParams.get("prompt");
    if (!storeParam && !toolParam && !promptParam) return;

    if (storeParam) setStoreName(storeParam);
    if (toolParam === "angles" || toolParam === "scripts" || toolParam === "formats") {
      setToolType(toolParam);
    }
    if (promptParam) setInput(promptParam);

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

  // Auto-save thread after each AI response
  const autoSave = useCallback(async (msgs: Message[]) => {
    try {
      const body: Record<string, unknown> = {
        store_name: storeName,
        tool_type: toolType,
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
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: storeName,
          tool_type: toolType,
          messages: newMessages,
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Server error (${res.status})`);
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");

      const fullMessages = [...newMessages, { role: "assistant" as const, content: json.text }];
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

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyAll = () => {
    const text = messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join("\n\n---\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

      {/* Readiness */}
      {docsReady >= totalRequired ? (
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
      )}

      {/* Tool selector */}
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

      {/* Main area */}
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

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-emerald-600/20 border border-emerald-700/50 text-white"
                    : "bg-gray-700/30 border border-gray-600/50 text-gray-200"
                }`}>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>
                  {msg.role === "assistant" && (
                    <button
                      onClick={() => handleCopyMessage(msg.content)}
                      className="mt-2 text-xs text-gray-500 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      {copied ? <CheckCircle size={12} className="text-green-400" /> : <Copy size={12} />}
                      Copy
                    </button>
                  )}
                </div>
              </div>
            ))}

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
                <Copy size={12} /> Copy All
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
    </div>
  );
}
