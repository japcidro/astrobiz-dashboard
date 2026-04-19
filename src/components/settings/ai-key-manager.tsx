"use client";

import { useState } from "react";
import { Sparkles, CheckCircle, AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  currentKey: string;
  settingKey?: string;
  title?: string;
  description?: string;
  label?: string;
  placeholder?: string;
  docsUrl?: string;
  docsLabel?: string;
  accent?: "purple" | "blue" | "emerald";
}

const ACCENT_CLASSES: Record<
  NonNullable<Props["accent"]>,
  { iconBg: string; iconText: string; ring: string; btn: string; link: string }
> = {
  purple: {
    iconBg: "bg-purple-600/20",
    iconText: "text-purple-400",
    ring: "focus:ring-purple-500",
    btn: "bg-purple-600 hover:bg-purple-500",
    link: "text-purple-400 hover:text-purple-300",
  },
  blue: {
    iconBg: "bg-blue-600/20",
    iconText: "text-blue-400",
    ring: "focus:ring-blue-500",
    btn: "bg-blue-600 hover:bg-blue-500",
    link: "text-blue-400 hover:text-blue-300",
  },
  emerald: {
    iconBg: "bg-emerald-600/20",
    iconText: "text-emerald-400",
    ring: "focus:ring-emerald-500",
    btn: "bg-emerald-600 hover:bg-emerald-500",
    link: "text-emerald-400 hover:text-emerald-300",
  },
};

export function AiKeyManager({
  currentKey,
  settingKey = "anthropic_api_key",
  title = "AI Settings",
  description = "Anthropic API key for AI ad generator",
  label = "Anthropic API Key",
  placeholder = "sk-ant-api03-...",
  docsUrl = "https://console.anthropic.com/settings/keys",
  docsLabel = "console.anthropic.com",
  accent = "purple",
}: Props) {
  const [apiKey, setApiKey] = useState(currentKey);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = ACCENT_CLASSES[accent];

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/ai/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _save_setting: settingKey,
          value: apiKey.trim(),
        }),
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
          <div className={`p-2 ${c.iconBg} rounded-lg`}>
            <Sparkles size={20} className={c.iconText} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="text-sm text-gray-400">{description}</p>
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
            <label className="block text-sm text-gray-300 mb-1.5">{label}</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={placeholder}
              className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 ${c.ring}`}
            />
            <p className="text-xs text-gray-500 mt-1">
              Get your key from{" "}
              <a
                href={docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={c.link}
              >
                {docsLabel}
              </a>
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim()}
            className={`flex items-center gap-1.5 ${c.btn} text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer`}
          >
            {saving && <RefreshCw size={14} className="animate-spin" />}
            {saving ? "Saving..." : "Save API Key"}
          </button>
        </div>
      </div>
    </div>
  );
}
