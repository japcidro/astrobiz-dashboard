"use client";

import { useState } from "react";
import { X, Save, RefreshCw } from "lucide-react";

interface Props {
  storeName: string;
  threadId: string | null;
  messageContent: string;
  messageIndex: number;
  onClose: () => void;
  onSaved: () => void;
}

export function SaveScriptModal({
  storeName,
  threadId,
  messageContent,
  messageIndex,
  onClose,
  onSaved,
}: Props) {
  const [angleTitle, setAngleTitle] = useState("");
  const [hook, setHook] = useState("");
  const [body, setBody] = useState(messageContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!angleTitle.trim() || !hook.trim() || !body.trim()) {
      setError("Angle title, hook, and body are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/approved-scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: storeName,
          source_thread_id: threadId,
          source_message_index: messageIndex,
          angle_title: angleTitle.trim(),
          hook: hook.trim(),
          body_script: body.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-base font-semibold text-white">
            Save to Approved Library
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Angle Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={angleTitle}
              onChange={(e) => setAngleTitle(e.target.value)}
              placeholder="e.g. Sino ang ate na sawa sa overpriced..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Hook <span className="text-red-400">*</span>
            </label>
            <textarea
              value={hook}
              onChange={(e) => setHook(e.target.value)}
              placeholder="First 3-5 seconds of the script"
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Body Script <span className="text-red-400">*</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none font-mono"
            />
          </div>
          {error && (
            <div className="p-2 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs">
              {error}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm text-gray-400 hover:text-white cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 cursor-pointer"
          >
            {saving ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
