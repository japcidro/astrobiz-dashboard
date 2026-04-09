"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import type {
  AdSetFormData,
  OptimizationGoal,
  TargetingInterest,
} from "@/lib/facebook/types";
import { TargetingSearch } from "./targeting-search";
import { PlacementPicker } from "./placement-picker";

interface PixelInfo {
  id: string;
  name: string;
}

const OPTIMIZATION_GOALS: {
  value: OptimizationGoal;
  label: string;
  desc: string;
}[] = [
  {
    value: "OFFSITE_CONVERSIONS",
    label: "Conversions",
    desc: "Optimize for purchases or other conversion events",
  },
  {
    value: "LINK_CLICKS",
    label: "Link Clicks",
    desc: "Get people to click through to your website",
  },
  {
    value: "LANDING_PAGE_VIEWS",
    label: "Landing Page Views",
    desc: "Optimize for people who load your page",
  },
  {
    value: "IMPRESSIONS",
    label: "Impressions",
    desc: "Show your ad to as many people as possible",
  },
];

const CONVERSION_EVENTS = [
  { value: "PURCHASE", label: "Purchase" },
  { value: "ADD_TO_CART", label: "Add to Cart" },
  { value: "INITIATE_CHECKOUT", label: "Initiate Checkout" },
  { value: "LEAD", label: "Lead" },
  { value: "COMPLETE_REGISTRATION", label: "Complete Registration" },
  { value: "VIEW_CONTENT", label: "View Content" },
];

const GENDER_OPTIONS = [
  { value: [] as number[], label: "All" },
  { value: [1], label: "Men" },
  { value: [2], label: "Women" },
];

interface StepAdsetProps {
  data: AdSetFormData;
  adAccountId: string;
  pageName: string;
  onUpdate: (updates: Partial<AdSetFormData>) => void;
}

export function StepAdset({ data, adAccountId, pageName, onUpdate }: StepAdsetProps) {
  const [pixels, setPixels] = useState<PixelInfo[]>([]);
  const [loadingPixels, setLoadingPixels] = useState(false);
  const [automaticPlacement, setAutomaticPlacement] = useState(true);

  // Fetch pixels
  useEffect(() => {
    if (!adAccountId) return;
    setLoadingPixels(true);
    fetch(`/api/facebook/create/pixels?account_id=${adAccountId}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) {
          setPixels(json.data);
          // Auto-select pixel: match by page name, fallback to first
          if (!data.promoted_object.pixel_id && json.data.length > 0) {
            let bestPixel = json.data[0];
            if (pageName) {
              const pageWords = pageName.toLowerCase().split(/\s+/);
              const match = json.data.find((p: PixelInfo) => {
                const pixelName = p.name.toLowerCase();
                return pageWords.some((word: string) => word.length > 2 && pixelName.includes(word));
              });
              if (match) bestPixel = match;
            }
            onUpdate({
              promoted_object: {
                ...data.promoted_object,
                pixel_id: bestPixel.id,
              },
            });
          }
        }
      })
      .finally(() => setLoadingPixels(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adAccountId]);

  // Re-match pixel when page name changes
  useEffect(() => {
    if (!pageName || pixels.length === 0) return;
    const pageWords = pageName.toLowerCase().split(/\s+/);
    const match = pixels.find((p) => {
      const pixelName = p.name.toLowerCase();
      return pageWords.some((word) => word.length > 2 && pixelName.includes(word));
    });
    if (match && match.id !== data.promoted_object.pixel_id) {
      onUpdate({
        promoted_object: {
          ...data.promoted_object,
          pixel_id: match.id,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageName]);

  const updateTargeting = (
    updates: Partial<AdSetFormData["targeting"]>
  ) => {
    onUpdate({ targeting: { ...data.targeting, ...updates } });
  };

  const interests =
    data.targeting.flexible_spec?.[0]?.interests || [];

  const setInterests = (items: TargetingInterest[]) => {
    updateTargeting({
      flexible_spec: items.length > 0 ? [{ interests: items }] : [],
    });
  };

  // Format today's date for min value
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-white mb-2">
          Ad Set Setup
        </h2>
        <p className="text-gray-400 text-sm">
          Configure targeting, budget, schedule, and placements.
        </p>
      </div>

      {/* Ad Set Name */}
      <div>
        <label className="block text-sm text-gray-400 mb-1.5">
          Ad Set Name
        </label>
        <input
          type="text"
          value={data.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="e.g. 25-45 Women - Metro Manila"
          className="w-full max-w-lg bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Budget */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Budget</label>
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50 max-w-lg">
          <div className="flex gap-3 mb-3">
            <button
              onClick={() =>
                onUpdate({
                  daily_budget: data.daily_budget ?? 500,
                  lifetime_budget: null,
                })
              }
              className={`px-3 py-1 rounded text-xs font-medium cursor-pointer ${
                data.daily_budget != null
                  ? "bg-white text-gray-900"
                  : "bg-gray-700 text-gray-400"
              }`}
            >
              Daily
            </button>
            <button
              onClick={() =>
                onUpdate({
                  lifetime_budget: data.lifetime_budget ?? 5000,
                  daily_budget: null,
                })
              }
              className={`px-3 py-1 rounded text-xs font-medium cursor-pointer ${
                data.lifetime_budget != null
                  ? "bg-white text-gray-900"
                  : "bg-gray-700 text-gray-400"
              }`}
            >
              Lifetime
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm">₱</span>
            <input
              type="number"
              value={data.daily_budget ?? data.lifetime_budget ?? ""}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || null;
                if (data.daily_budget != null) {
                  onUpdate({ daily_budget: val });
                } else {
                  onUpdate({ lifetime_budget: val });
                }
              }}
              min="1"
              className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Schedule */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Schedule</label>
        <div className="flex gap-4 max-w-lg">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={data.start_time ? data.start_time.split("T")[0] : ""}
              onChange={(e) =>
                onUpdate({
                  start_time: e.target.value
                    ? `${e.target.value}T00:00:00+08:00`
                    : "",
                })
              }
              min={today}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">
              End Date{" "}
              <span className="text-gray-600">
                {data.lifetime_budget != null ? "(required)" : "(optional)"}
              </span>
            </label>
            <input
              type="date"
              value={
                data.end_time ? data.end_time.split("T")[0] : ""
              }
              onChange={(e) =>
                onUpdate({
                  end_time: e.target.value
                    ? `${e.target.value}T23:59:59+08:00`
                    : null,
                })
              }
              min={
                data.start_time
                  ? data.start_time.split("T")[0]
                  : today
              }
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Targeting */}
      <div>
        <h3 className="text-sm font-medium text-white mb-3">Targeting</h3>

        <div className="space-y-4 max-w-lg">
          {/* Location */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Location
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-300">Philippines (PH)</span>
              <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
                Default
              </span>
            </div>
          </div>

          {/* Age */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Age: {data.targeting.age_min} -{" "}
              {data.targeting.age_max === 65
                ? "65+"
                : data.targeting.age_max}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={18}
                max={65}
                value={data.targeting.age_min}
                onChange={(e) =>
                  updateTargeting({ age_min: parseInt(e.target.value) })
                }
                className="flex-1 accent-white"
              />
              <span className="text-gray-500 text-xs">to</span>
              <input
                type="range"
                min={18}
                max={65}
                value={data.targeting.age_max}
                onChange={(e) =>
                  updateTargeting({ age_max: parseInt(e.target.value) })
                }
                className="flex-1 accent-white"
              />
            </div>
          </div>

          {/* Gender */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Gender
            </label>
            <div className="flex gap-2">
              {GENDER_OPTIONS.map((opt) => {
                const isSelected =
                  JSON.stringify(data.targeting.genders) ===
                  JSON.stringify(opt.value);
                return (
                  <button
                    key={opt.label}
                    onClick={() => updateTargeting({ genders: opt.value })}
                    className={`px-4 py-1.5 rounded-lg text-sm cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-white text-gray-900 font-medium"
                        : "bg-gray-700 text-gray-400 hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Interests */}
          <TargetingSearch
            label="Interests"
            selected={interests}
            onChange={setInterests}
          />
        </div>
      </div>

      {/* Placements */}
      <PlacementPicker
        automatic={automaticPlacement}
        platforms={data.targeting.publisher_platforms || []}
        facebookPositions={data.targeting.facebook_positions || []}
        instagramPositions={data.targeting.instagram_positions || []}
        onToggleAutomatic={() => {
          setAutomaticPlacement(!automaticPlacement);
          if (!automaticPlacement) {
            // Switching to automatic — clear manual selections
            updateTargeting({
              publisher_platforms: undefined,
              facebook_positions: undefined,
              instagram_positions: undefined,
            });
          } else {
            // Switching to manual — set defaults
            updateTargeting({
              publisher_platforms: ["facebook", "instagram"],
              facebook_positions: ["feed", "story"],
              instagram_positions: ["stream", "story"],
            });
          }
        }}
        onUpdate={(updates) => {
          const targeting: Partial<AdSetFormData["targeting"]> = {};
          if (updates.platforms) targeting.publisher_platforms = updates.platforms;
          if (updates.facebookPositions)
            targeting.facebook_positions = updates.facebookPositions;
          if (updates.instagramPositions)
            targeting.instagram_positions = updates.instagramPositions;
          updateTargeting(targeting);
        }}
      />

      {/* Optimization */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">
          Optimization Goal
        </label>
        <div className="space-y-2 max-w-lg">
          {OPTIMIZATION_GOALS.map((goal) => (
            <button
              key={goal.value}
              onClick={() => onUpdate({ optimization_goal: goal.value })}
              className={`w-full p-3 rounded-lg border text-left transition-all cursor-pointer ${
                data.optimization_goal === goal.value
                  ? "border-white bg-white/5"
                  : "border-gray-700 hover:border-gray-600"
              }`}
            >
              <span
                className={`text-sm font-medium ${
                  data.optimization_goal === goal.value
                    ? "text-white"
                    : "text-gray-300"
                }`}
              >
                {goal.label}
              </span>
              <p className="text-xs text-gray-500 mt-0.5">{goal.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Conversion Event + Pixel (if conversions) */}
      {data.optimization_goal === "OFFSITE_CONVERSIONS" && (
        <div className="space-y-4 max-w-lg">
          {/* Pixel */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Facebook Pixel
            </label>
            {loadingPixels ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                <Loader2 size={14} className="animate-spin" />
                Loading pixels...
              </div>
            ) : (
              <select
                value={data.promoted_object.pixel_id}
                onChange={(e) =>
                  onUpdate({
                    promoted_object: {
                      ...data.promoted_object,
                      pixel_id: e.target.value,
                    },
                  })
                }
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select pixel...</option>
                {pixels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.id})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Conversion Event */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Conversion Event
            </label>
            <select
              value={data.promoted_object.custom_event_type}
              onChange={(e) =>
                onUpdate({
                  promoted_object: {
                    ...data.promoted_object,
                    custom_event_type: e.target.value,
                  },
                })
              }
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CONVERSION_EVENTS.map((ev) => (
                <option key={ev.value} value={ev.value}>
                  {ev.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
