"use client";

import { useState } from "react";
import { Phone, Settings as SettingsIcon, History, Inbox } from "lucide-react";
import type {
  CallConfirmerConfig,
  ShopifyStoreLite,
} from "@/lib/call-confirmer/types";
import { SettingsTab } from "@/components/call-confirmer/settings-tab";
import { TestCallTab } from "@/components/call-confirmer/test-call-tab";
import { LeadsTab } from "@/components/call-confirmer/leads-tab";
import { HistoryTab } from "@/components/call-confirmer/history-tab";

type TabKey = "leads" | "history" | "test" | "settings";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "leads", label: "Leads", icon: <Inbox size={16} /> },
  { key: "history", label: "Call History", icon: <History size={16} /> },
  { key: "test", label: "Test Call", icon: <Phone size={16} /> },
  { key: "settings", label: "Settings", icon: <SettingsIcon size={16} /> },
];

interface Props {
  initialStores: ShopifyStoreLite[];
  initialConfigs: CallConfirmerConfig[];
  employeeId: string;
}

export function CallConfirmerClient({
  initialStores,
  initialConfigs,
  employeeId,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("leads");
  const [stores] = useState<ShopifyStoreLite[]>(initialStores);
  const [configs, setConfigs] = useState<CallConfirmerConfig[]>(initialConfigs);
  const [selectedStoreId, setSelectedStoreId] = useState<string>(
    initialStores[0]?.id ?? ""
  );

  if (stores.length === 0) {
    return (
      <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-6">
        <p className="text-yellow-200 font-medium mb-1">No active stores</p>
        <p className="text-sm text-yellow-300/80">
          Add at least one Shopify store sa Admin → Settings bago mo magamit
          ang Call Confirmer.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Tab nav */}
      <div className="flex items-center gap-1 border-b border-gray-800 mb-6 overflow-x-auto">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                isActive
                  ? "border-emerald-500 text-white"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "leads" && (
          <LeadsTab
            stores={stores}
            configs={configs}
            selectedStoreId={selectedStoreId}
            onStoreChange={setSelectedStoreId}
          />
        )}
        {activeTab === "history" && (
          <HistoryTab
            stores={stores}
            selectedStoreId={selectedStoreId}
            onStoreChange={setSelectedStoreId}
          />
        )}
        {activeTab === "test" && (
          <TestCallTab
            stores={stores}
            configs={configs}
            selectedStoreId={selectedStoreId}
            onStoreChange={setSelectedStoreId}
            employeeId={employeeId}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            stores={stores}
            configs={configs}
            onConfigsChange={setConfigs}
            selectedStoreId={selectedStoreId}
            onStoreChange={setSelectedStoreId}
          />
        )}
      </div>
    </div>
  );
}
