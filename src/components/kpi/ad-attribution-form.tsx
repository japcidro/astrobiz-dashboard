"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";

interface Entry {
  fb_ad_id: string;
  ad_name: string | null;
  campaign_id: string | null;
  is_test: boolean;
  tagged_at: string;
  fb_created_time: string | null;
  created_by: string | null;
  employees: { full_name: string } | null;
}

export function AdAttributionForm() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [adId, setAdId] = useState("");
  const [adName, setAdName] = useState("");
  const [isTest, setIsTest] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/kpi/fb-ad-attribution", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setEntries(data.entries ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adId.trim()) {
      setMessage("FB ad ID is required.");
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const res = await fetch("/api/kpi/fb-ad-attribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fb_ad_id: adId.trim(),
        ad_name: adName.trim() || undefined,
        is_test: isTest,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(`Error: ${data.error}`);
    } else {
      setMessage("Tagged. The 'creatives tested / week' KPI will update next compute.");
      setAdId("");
      setAdName("");
      setIsTest(true);
      load();
    }
    setSubmitting(false);
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Creative Attribution</h1>
          <p className="text-sm text-gray-500">
            Claim ownership of FB ads you created. Counts toward your
            <span className="text-gray-300"> creatives tested / week KPI</span> when
            <span className="text-gray-300"> is_test = true</span>.
          </p>
        </div>
        <button onClick={load} className="text-gray-400 hover:text-white p-2 rounded cursor-pointer">
          <RefreshCw size={18} />
        </button>
      </div>

      <form
        onSubmit={submit}
        className="bg-gray-900/40 border border-gray-800 rounded-lg p-4 mb-6 space-y-3"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">
            FB ad ID
            <input
              type="text"
              value={adId}
              onChange={(e) => setAdId(e.target.value)}
              placeholder="e.g. 6234567890123"
              className="mt-1 w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
              required
            />
          </label>
          <label className="text-xs text-gray-400">
            Ad name (optional)
            <input
              type="text"
              value={adName}
              onChange={(e) => setAdName(e.target.value)}
              placeholder="e.g. Hook A v3"
              className="mt-1 w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={isTest}
            onChange={(e) => setIsTest(e.target.checked)}
          />
          New test creative (uncheck if this is a duplicate / scaling iteration)
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 bg-white text-gray-900 font-medium px-3 py-1.5 rounded cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
            {submitting ? "Tagging…" : "Claim ad"}
          </button>
          {message && <span className="text-xs text-gray-400">{message}</span>}
        </div>
      </form>

      <h2 className="text-sm font-medium text-gray-300 mb-2">Tagged in last 7 days</h2>
      <div className="bg-gray-900/40 border border-gray-800 rounded-lg overflow-hidden">
        {loading ? (
          <p className="p-4 text-xs text-gray-500">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="p-4 text-xs text-gray-500">No ads tagged yet this week.</p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {entries.map((e) => (
              <li key={e.fb_ad_id} className="p-3 text-xs text-gray-300">
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="font-medium">{e.ad_name ?? e.fb_ad_id}</p>
                    <p className="text-gray-500 text-[10px]">
                      {e.fb_ad_id} · {e.is_test ? "🟢 test" : "⚪ scaling/duplicate"}
                    </p>
                  </div>
                  <p className="text-gray-500 text-[10px] whitespace-nowrap">
                    {e.employees?.full_name ?? "?"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
