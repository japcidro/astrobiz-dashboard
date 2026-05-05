"use client";

import { Inbox } from "lucide-react";
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
}

export function LeadsTab({
  stores,
  configs,
  selectedStoreId,
  onStoreChange,
}: Props) {
  const config = configs.find((c) => c.store_id === selectedStoreId);
  const enabled = !!config?.enabled;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <StoreSelector
          stores={stores}
          value={selectedStoreId}
          onChange={onStoreChange}
        />
      </div>

      {!enabled && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-6 mb-4">
          <p className="text-yellow-200 font-medium mb-1">
            Call Confirmer is disabled for this store
          </p>
          <p className="text-sm text-yellow-300/80">
            Pumunta sa <strong>Settings</strong> tab para i-configure at
            i-enable ang AI caller for this store.
          </p>
        </div>
      )}

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-12 text-center">
        <Inbox size={32} className="mx-auto text-gray-600 mb-3" />
        <p className="text-gray-400 mb-1">Leads view coming next</p>
        <p className="text-sm text-gray-500">
          Manual lead selection from Shopify orders will go here. We&apos;re
          building Settings + Test Call first.
        </p>
      </div>
    </div>
  );
}
