"use client";

import {
  X,
  Package,
  Copy,
  CheckCircle,
  Info,
  Layers,
} from "lucide-react";
import { useState } from "react";
import type { InventoryProduct } from "@/lib/shopify/types";

interface Props {
  product: InventoryProduct;
  isAdmin: boolean;
  onClose: () => void;
}

function formatCurrency(val: string) {
  const num = parseFloat(val);
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1 text-gray-500 hover:text-white transition-colors cursor-pointer"
      title="Copy"
    >
      {copied ? <CheckCircle size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

function StockBadge({ stock }: { stock: number }) {
  if (stock === 0) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-900/30 text-red-400">
        Out of stock
      </span>
    );
  }
  if (stock >= 1 && stock <= 9) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-900/30 text-yellow-400">
        Low ({stock})
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-900/30 text-green-400">
      {stock}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-900/30 text-green-400",
    draft: "bg-yellow-900/30 text-yellow-400",
    archived: "bg-gray-700/50 text-gray-400",
  };
  const cls = styles[status] || "bg-gray-700/50 text-gray-400";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-gray-400">{icon}</span>
        <h3 className="text-sm font-medium text-white">{title}</h3>
      </div>
      <div className="pl-6">{children}</div>
    </div>
  );
}

export function ProductDetailPanel({ product, isAdmin, onClose }: Props) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-gray-900 border-l border-gray-700 z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-white">{product.title}</h2>
            <p className="text-sm text-gray-400">{product.store_name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Status */}
          <div className="flex items-center gap-3">
            <StatusBadge status={product.status} />
          </div>

          {/* Product Image */}
          <div>
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.title}
                className="w-full max-h-64 object-contain rounded-lg bg-gray-800"
              />
            ) : (
              <div className="w-full h-48 bg-gray-800 rounded-lg flex items-center justify-center">
                <Package size={48} className="text-gray-600" />
              </div>
            )}
          </div>

          {/* Info */}
          <Section icon={<Info size={16} />} title="Product Info">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Product Type</span>
                <span className="text-gray-300">{product.product_type || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Vendor</span>
                <span className="text-gray-300">{product.vendor || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Inventory</span>
                <span className="text-white font-medium">{product.total_inventory.toLocaleString()}</span>
              </div>
            </div>
          </Section>

          {/* Variants */}
          <Section icon={<Layers size={16} />} title={`Variants (${product.variants.length})`}>
            <div className="space-y-3">
              {product.variants.map((v) => (
                <div
                  key={v.id}
                  className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      {v.title === "Default Title" ? "Default" : v.title}
                    </span>
                    <StockBadge stock={v.inventory_quantity} />
                  </div>

                  <div className="space-y-1 text-xs">
                    {v.sku && (
                      <div className="flex items-center gap-1 text-gray-400">
                        <span className="text-gray-500">SKU:</span>
                        <span className="font-mono">{v.sku}</span>
                        <CopyButton text={v.sku} />
                      </div>
                    )}
                    {v.barcode && (
                      <div className="flex items-center gap-1 text-gray-400">
                        <span className="text-gray-500">Barcode:</span>
                        <span className="font-mono">{v.barcode}</span>
                        <CopyButton text={v.barcode} />
                      </div>
                    )}
                    {isAdmin && (
                      <div className="flex items-center gap-1 text-gray-400">
                        <span className="text-gray-500">Price:</span>
                        <span className="text-white font-medium">{formatCurrency(v.price)}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
