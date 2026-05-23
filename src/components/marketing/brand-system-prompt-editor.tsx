"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";

interface Props {
  storeName: string;
}

const PLACEHOLDER = `Example:
You are writing ad scripts for [Brand Name], a Filipino e-commerce store selling [product category]. Match the brand voice in the reference files. Default to Taglish at a 70/30 ratio. Open hooks should be specific (sino, kelan, saan). Avoid generic claims. Always include a CTA at the end.`;

export function BrandSystemPromptEditor({ storeName }: Props) {
  const [prompt, setPrompt] = useState("");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!storeName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ai/brand-prompt?store=${encodeURIComponent(storeName)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load prompt");
      const value: string = json.prompt?.system_prompt ?? "";
      setPrompt(value);
      setOriginalPrompt(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load prompt");
    } finally {
      setLoading(false);
    }
  }, [storeName]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/brand-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: storeName,
          system_prompt: prompt,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setOriginalPrompt(prompt);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [storeName, prompt]);

  const dirty = prompt !== originalPrompt;

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-700/50 flex items-center gap-2">
        <p className="text-xs font-medium text-gray-400 uppercase flex-1">
          System Prompt
        </p>
        {savedAt && (
          <span className="text-[10px] text-green-400 flex items-center gap-1">
            <CheckCircle size={10} />
            Saved
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded-md flex items-center gap-1 cursor-pointer"
        >
          {saving ? (
            <RefreshCw size={11} className="animate-spin" />
          ) : (
            <Save size={11} />
          )}
          Save
        </button>
      </div>
      <div className="p-3">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <RefreshCw size={14} className="animate-spin text-gray-500" />
          </div>
        ) : (
          <>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={PLACEHOLDER}
              rows={20}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y font-mono min-h-[200px]"
            />
            <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-500">
              <span>
                {prompt.length.toLocaleString()} chars · ~
                {Math.round(prompt.length / 4).toLocaleString()} tokens
              </span>
              {dirty && (
                <span className="text-yellow-500">Unsaved changes</span>
              )}
            </div>
          </>
        )}
        {error && (
          <div className="mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-[11px] flex items-start gap-1.5">
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
