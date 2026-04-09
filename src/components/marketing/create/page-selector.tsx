"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";

interface PageInfo {
  id: string;
  name: string;
  picture?: { data?: { url?: string } };
}

interface PageSelectorProps {
  selectedPageId: string;
  onChange: (pageId: string) => void;
}

export function PageSelector({ selectedPageId, onChange }: PageSelectorProps) {
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/facebook/create/pages")
      .then((r) => r.json())
      .then((json) => {
        if (json.error) {
          setError(json.error);
        } else if (json.data) {
          setPages(json.data);
          // Auto-select first page if none selected
          if (!selectedPageId && json.data.length > 0) {
            onChange(json.data[0].id);
          }
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div>
        <label className="block text-sm text-gray-400 mb-1.5">
          Facebook Page
        </label>
        <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
          <Loader2 size={14} className="animate-spin" />
          Loading pages...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <label className="block text-sm text-gray-400 mb-1.5">
          Facebook Page
        </label>
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div>
        <label className="block text-sm text-gray-400 mb-1.5">
          Facebook Page
        </label>
        <p className="text-sm text-red-400">
          No Facebook Pages found. Your System User token needs Page access.
        </p>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1.5">
        Facebook Page
      </label>
      <div className="space-y-2">
        {pages.map((page) => {
          const isSelected = selectedPageId === page.id;
          const picUrl = page.picture?.data?.url;
          return (
            <button
              key={page.id}
              onClick={() => onChange(page.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all cursor-pointer ${
                isSelected
                  ? "border-white bg-white/5"
                  : "border-gray-700 hover:border-gray-600"
              }`}
            >
              {picUrl ? (
                <img
                  src={picUrl}
                  alt={page.name}
                  className="w-8 h-8 rounded-full"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 text-xs font-medium">
                  {page.name.charAt(0)}
                </div>
              )}
              <span
                className={`text-sm font-medium ${isSelected ? "text-white" : "text-gray-300"}`}
              >
                {page.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
