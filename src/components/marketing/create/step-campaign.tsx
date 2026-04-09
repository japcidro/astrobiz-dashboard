"use client";

import type {
  CampaignFormData,
  CampaignObjective,
  BidStrategy,
} from "@/lib/facebook/types";
import { ShoppingCart, MousePointer, Heart, UserPlus } from "lucide-react";

const OBJECTIVES: {
  value: CampaignObjective;
  label: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "OUTCOME_SALES",
    label: "Sales",
    desc: "Drive purchases on your website",
    icon: <ShoppingCart size={20} />,
  },
  {
    value: "OUTCOME_TRAFFIC",
    label: "Traffic",
    desc: "Send people to your website",
    icon: <MousePointer size={20} />,
  },
  {
    value: "OUTCOME_ENGAGEMENT",
    label: "Engagement",
    desc: "Get more likes, comments, shares",
    icon: <Heart size={20} />,
  },
  {
    value: "OUTCOME_LEADS",
    label: "Leads",
    desc: "Collect leads for your business",
    icon: <UserPlus size={20} />,
  },
];

const BID_STRATEGIES: { value: BidStrategy; label: string; desc: string }[] = [
  {
    value: "LOWEST_COST_WITHOUT_CAP",
    label: "Lowest Cost",
    desc: "Get the most results for your budget",
  },
  {
    value: "COST_CAP",
    label: "Cost Cap",
    desc: "Set a max cost per result",
  },
  {
    value: "BID_CAP",
    label: "Bid Cap",
    desc: "Set max bid in each auction",
  },
];

interface StepCampaignProps {
  data: CampaignFormData;
  onUpdate: (updates: Partial<CampaignFormData>) => void;
}

export function StepCampaign({ data, onUpdate }: StepCampaignProps) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-2">Campaign Setup</h2>
      <p className="text-gray-400 text-sm mb-6">
        Choose your campaign objective and settings.
      </p>

      {/* Campaign Name */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-1.5">
          Campaign Name
        </label>
        <input
          type="text"
          value={data.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="e.g. PH - Summer Sale 2026"
          className="w-full max-w-lg bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Objective */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-2">Objective</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
          {OBJECTIVES.map((obj) => (
            <button
              key={obj.value}
              onClick={() => onUpdate({ objective: obj.value })}
              className={`p-3 rounded-lg border-2 text-left transition-all cursor-pointer ${
                data.objective === obj.value
                  ? "border-white bg-white/5"
                  : "border-gray-700 hover:border-gray-600"
              }`}
            >
              <div
                className={
                  data.objective === obj.value
                    ? "text-white"
                    : "text-gray-500"
                }
              >
                {obj.icon}
              </div>
              <h4
                className={`text-sm font-medium mt-2 ${
                  data.objective === obj.value
                    ? "text-white"
                    : "text-gray-300"
                }`}
              >
                {obj.label}
              </h4>
              <p className="text-xs text-gray-500 mt-0.5">{obj.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* CBO Toggle */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() =>
              onUpdate({
                campaign_budget_optimization:
                  !data.campaign_budget_optimization,
              })
            }
            className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer"
            style={{
              backgroundColor: data.campaign_budget_optimization
                ? "rgb(34 197 94 / 0.6)"
                : "rgb(75 85 99 / 0.6)",
            }}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                data.campaign_budget_optimization
                  ? "translate-x-[18px]"
                  : "translate-x-[3px]"
              }`}
            />
          </button>
          <div>
            <span className="text-sm text-white font-medium">
              Campaign Budget Optimization (CBO)
            </span>
            <p className="text-xs text-gray-500">
              FB distributes budget across ad sets automatically
            </p>
          </div>
        </div>
      </div>

      {/* Budget (shown when CBO is on) */}
      {data.campaign_budget_optimization && (
        <div className="mb-6 bg-gray-800/50 rounded-xl p-4 border border-gray-700/50 max-w-lg">
          <div className="flex gap-3 mb-3">
            <button
              onClick={() =>
                onUpdate({ daily_budget: data.daily_budget ?? 500, lifetime_budget: null })
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
                onUpdate({ lifetime_budget: data.lifetime_budget ?? 5000, daily_budget: null })
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
      )}

      {/* Bid Strategy */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-2">
          Bid Strategy
        </label>
        <div className="space-y-2 max-w-lg">
          {BID_STRATEGIES.map((s) => (
            <button
              key={s.value}
              onClick={() => onUpdate({ bid_strategy: s.value })}
              className={`w-full p-3 rounded-lg border text-left transition-all cursor-pointer ${
                data.bid_strategy === s.value
                  ? "border-white bg-white/5"
                  : "border-gray-700 hover:border-gray-600"
              }`}
            >
              <span
                className={`text-sm font-medium ${
                  data.bid_strategy === s.value
                    ? "text-white"
                    : "text-gray-300"
                }`}
              >
                {s.label}
              </span>
              <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
