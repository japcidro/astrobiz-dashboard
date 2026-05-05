"use client";

import { Phone } from "lucide-react";
import type {
  CallConfirmerConfig,
  ShopifyStoreLite,
} from "@/lib/call-confirmer/types";
import { StoreSelector } from "./store-selector";

interface Props {
  stores: ShopifyStoreLite[];
  configs: CallConfirmerConfig[];
  selectedStoreId: string;
  onStoreChange: (id: string) => void;
  employeeId: string;
}

export function TestCallTab({
  stores,
  configs,
  selectedStoreId,
  onStoreChange,
}: Props) {
  const config = configs.find((c) => c.store_id === selectedStoreId);
  const ready = !!config?.voice_id;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <StoreSelector
          stores={stores}
          value={selectedStoreId}
          onChange={onStoreChange}
        />
      </div>

      {!ready && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-6 mb-4">
          <p className="text-yellow-200 font-medium mb-1">
            Configure Settings first
          </p>
          <p className="text-sm text-yellow-300/80">
            Pumili ng voice + i-set ang greeting sa <strong>Settings</strong>{" "}
            tab bago mag-test call.
          </p>
        </div>
      )}

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-12 text-center">
        <Phone size={32} className="mx-auto text-gray-600 mb-3" />
        <p className="text-gray-400 mb-1">Test Call coming next</p>
        <p className="text-sm text-gray-500">
          Wiring Vapi outbound + webhook handler next. Then this tab lets you
          call yourself with a sample order so you can experience Maria.
        </p>
      </div>
    </div>
  );
}
