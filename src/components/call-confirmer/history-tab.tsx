"use client";

import { History } from "lucide-react";
import type { ShopifyStoreLite } from "@/lib/call-confirmer/types";
import { StoreSelector } from "./store-selector";

interface Props {
  stores: ShopifyStoreLite[];
  selectedStoreId: string;
  onStoreChange: (id: string) => void;
}

export function HistoryTab({ stores, selectedStoreId, onStoreChange }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <StoreSelector
          stores={stores}
          value={selectedStoreId}
          onChange={onStoreChange}
        />
      </div>

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-12 text-center">
        <History size={32} className="mx-auto text-gray-600 mb-3" />
        <p className="text-gray-400 mb-1">Call history coming next</p>
        <p className="text-sm text-gray-500">
          Once test calls are working, every call attempt will appear here with
          transcript, summary, recording, and cost.
        </p>
      </div>
    </div>
  );
}
