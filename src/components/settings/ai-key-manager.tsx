"use client";

import { useState } from "react";
import { Sparkles, CheckCircle, AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  currentKey: string;
}

export function AiKeyManager({ currentKey }: Props) {
  const [apiKey, setApiKey] = useState(currentKey);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/ai/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _save_setting: "anthropic_api_key", value: apiKey.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");
      setSuccess("API key saved");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-purple-600/20 rounded-lg">
            <Sparkles size={20} className="text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">AI Settings</h2>
            <p className="text-sm text-gray-400">Anthropic API key for AI ad generator</p>
          </div>
        </div>

        {success && (
          <div className="mb-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm flex items-center gap-2">
            <CheckCircle size={16} /> {success}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1.5">Anthropic API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-api03-..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Get your key from{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">
                console.anthropic.com
              </a>
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim()}
            className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            {saving && <RefreshCw size={14} className="animate-spin" />}
            {saving ? "Saving..." : "Save API Key"}
          </button>
        </div>
      </div>
    </div>
  );
}
