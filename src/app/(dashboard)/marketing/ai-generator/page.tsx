"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Sparkles,
  Send,
  RefreshCw,
  Copy,
  CheckCircle,
  AlertTriangle,
  Trash2,
  Save,
} from "lucide-react";
import type { AiStoreDoc } from "@/lib/ai/types";
import { DOC_TYPES } from "@/lib/ai/types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AiGeneratorPage() {
  const [stores, setStores] = useState<{ name: string }[]>([]);
  const [storeName, setStoreName] = useState("");
  const [docs, setDocs] = useState<AiStoreDoc[]>([]);
  const [docsReady, setDocsReady] = useState(0);
  const [loading, setLoading] = useState(true);

  // Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  // Fetch docs when store changes
  useEffect(() => {
    if (!storeName) return;
    fetch(`/api/ai/docs?store=${encodeURIComponent(storeName)}`)
      .then((r) => r.json())
      .then((json) => {
        const storeDocs = json.docs || [];
        setDocs(storeDocs);
        const filled = DOC_TYPES.filter((dt) =>
          storeDocs.some((d: AiStoreDoc) => d.doc_type === dt.key)
        ).length;
        setDocsReady(filled);
      })
      .catch(() => setDocsReady(0));
  }, [storeName]);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, generating]);

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
          messages: newMessages,
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Server error (${res.status})`);
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");

      setMessages([...newMessages, { role: "assistant", content: json.text }]);
      setSaved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, messages, generating, storeName]);

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
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    if (messages.length === 0) return;
    setSaving(true);
    try {
      await fetch("/api/ai/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: storeName,
          tool_type: "chat",
          input_data: { messages },
          output_data: { messages },
        }),
      });
      setSaved(true);
    } catch {} finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
    setSaved(false);
  };

  const notReady = docsReady < DOC_TYPES.length;

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
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-600/20 rounded-lg">
            <Sparkles size={20} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">AI Generator</h1>
            <p className="text-gray-400 text-sm">Chat with AI using your store&apos;s knowledge</p>
          </div>
        </div>
        <select
          value={storeName}
          onChange={(e) => { setStoreName(e.target.value); handleClear(); }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          {stores.map((s) => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Readiness banner */}
      {docsReady >= DOC_TYPES.length ? (
        <div className="mb-3 p-2.5 bg-green-900/20 border border-green-700/50 rounded-lg text-green-300 text-sm flex items-center gap-2">
          <CheckCircle size={16} />
          {DOC_TYPES.length}/{DOC_TYPES.length} docs ready — All knowledge documents are set
        </div>
      ) : (
        <div className="mb-3 p-2.5 bg-yellow-900/20 border border-yellow-700/50 rounded-lg text-yellow-300 text-sm flex items-center gap-2">
          <AlertTriangle size={16} />
          {docsReady}/{DOC_TYPES.length} docs ready —{" "}
          <a href="/marketing/ai-settings" className="underline hover:text-yellow-200">
            Go to AI Knowledge
          </a>{" "}
          to fill in the remaining documents
        </div>
      )}

      {/* Chat area */}
      <div className="flex-1 bg-gray-800/30 border border-gray-700/50 rounded-xl overflow-hidden flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <Sparkles size={40} className="text-gray-600 mb-4" />
              <p className="text-gray-400 text-lg font-medium mb-2">
                Start a conversation
              </p>
              <p className="text-gray-500 text-sm max-w-md">
                Ask the AI to generate ad angles, write scripts, expand formats, or anything creative for <strong className="text-gray-300">{storeName}</strong>.
                The AI has access to all your knowledge documents.
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
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-emerald-600/20 border border-emerald-700/50 text-white"
                    : "bg-gray-700/30 border border-gray-600/50 text-gray-200"
                }`}
              >
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {msg.content}
                </div>
                {msg.role === "assistant" && (
                  <button
                    onClick={() => handleCopyMessage(msg.content)}
                    className="mt-2 text-xs text-gray-500 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Copy size={12} />
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
            <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Actions bar */}
        {messages.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-700/50 flex items-center gap-2">
            <button
              onClick={handleCopyAll}
              className="text-xs text-gray-500 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
            >
              {copied ? <CheckCircle size={12} className="text-green-400" /> : <Copy size={12} />}
              {copied ? "Copied!" : "Copy All"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || saved}
              className="text-xs text-gray-500 hover:text-white flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
            >
              {saved ? <CheckCircle size={12} className="text-green-400" /> : <Save size={12} />}
              {saved ? "Saved" : saving ? "Saving..." : "Save to History"}
            </button>
            <button
              onClick={handleClear}
              className="text-xs text-gray-500 hover:text-red-400 flex items-center gap-1 transition-colors cursor-pointer ml-auto"
            >
              <Trash2 size={12} />
              Clear Chat
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
              {generating ? (
                <RefreshCw size={18} className="animate-spin" />
              ) : (
                <Send size={18} />
              )}
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-1.5">
            Enter to send, Shift+Enter for new line. AI has access to all {storeName} knowledge docs.
          </p>
        </div>
      </div>
    </div>
  );
}
