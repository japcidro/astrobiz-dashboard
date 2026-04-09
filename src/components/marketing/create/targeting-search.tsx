"use client";

import { useState, useRef, useEffect } from "react";
import { Search, X, Loader2 } from "lucide-react";
import type { TargetingInterest } from "@/lib/facebook/types";

interface TargetingSearchProps {
  label: string;
  selected: TargetingInterest[];
  onChange: (items: TargetingInterest[]) => void;
  searchType?: "adinterest" | "adTargetingCategory";
}

export function TargetingSearch({
  label,
  selected,
  onChange,
  searchType = "adinterest",
}: TargetingSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{ id: string; name: string; audience_size: number | null }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const search = (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    fetch(
      `/api/facebook/create/targeting?q=${encodeURIComponent(q)}&type=${searchType}`
    )
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setResults(json.data);
      })
      .finally(() => setLoading(false));
  };

  const handleInput = (value: string) => {
    setQuery(value);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  };

  const addItem = (item: { id: string; name: string }) => {
    if (selected.some((s) => s.id === item.id)) return;
    onChange([...selected, { id: item.id, name: item.name }]);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const removeItem = (id: string) => {
    onChange(selected.filter((s) => s.id !== id));
  };

  const fmtAudience = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
  };

  // Filter out already selected
  const filteredResults = results.filter(
    (r) => !selected.some((s) => s.id === r.id)
  );

  return (
    <div ref={containerRef}>
      <label className="block text-sm text-gray-400 mb-1.5">{label}</label>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 bg-gray-700 text-white text-xs px-2 py-1 rounded"
            >
              {item.name}
              <button
                onClick={() => removeItem(item.id)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => query.length >= 2 && setOpen(true)}
          placeholder="Search interests..."
          className="w-full bg-gray-900 border border-gray-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {loading && (
          <Loader2
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin"
          />
        )}

        {/* Dropdown */}
        {open && filteredResults.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-48 overflow-y-auto">
            {filteredResults.map((item) => (
              <button
                key={item.id}
                onClick={() => addItem(item)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-700 transition-colors cursor-pointer flex items-center justify-between"
              >
                <span className="text-white">{item.name}</span>
                {item.audience_size && (
                  <span className="text-gray-500 text-xs">
                    {fmtAudience(item.audience_size)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {open && query.length >= 2 && !loading && filteredResults.length === 0 && (
          <div className="absolute z-20 mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg p-3 text-sm text-gray-500">
            No results found
          </div>
        )}
      </div>
    </div>
  );
}
