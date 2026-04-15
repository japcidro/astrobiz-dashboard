"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Printer, Tag } from "lucide-react";
import { generateBarcodeDataUrl } from "@/lib/fulfillment/barcode";

interface Product {
  sku: string;
  barcode: string | null;
  product_title: string;
  variant_title: string | null;
}

interface BarcodeLabel {
  sku: string;
  product_title: string;
  variant_title: string | null;
  dataUrl: string;
}

const LABEL_SIZES = [
  { label: "30x20mm", value: "30x20" },
] as const;

type LabelSize = (typeof LABEL_SIZES)[number]["value"];

const SIZE_STYLES: Record<LabelSize, { width: string; height: string }> = {
  "30x20": { width: "113px", height: "76px" },
};

export default function BarcodesPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelSize, setLabelSize] = useState<LabelSize>("30x20");
  const [generating, setGenerating] = useState(false);
  const [labels, setLabels] = useState<BarcodeLabel[]>([]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ store: storeFilter });
      const res = await fetch(`/api/shopify/inventory?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      const rows = (json.rows || []) as Array<{
        sku: string | null;
        barcode?: string | null;
        product_title: string;
        variant_title: string;
      }>;

      const uniqueProducts = new Map<string, Product>();
      for (const row of rows) {
        if (!row.sku) continue;
        if (uniqueProducts.has(row.sku)) continue;
        uniqueProducts.set(row.sku, {
          sku: row.sku,
          barcode: row.barcode || null,
          product_title: row.product_title,
          variant_title: row.variant_title || null,
        });
      }

      setProducts(Array.from(uniqueProducts.values()));
      if (json.stores) setStores(json.stores);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, [storeFilter]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  function toggleSelect(sku: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === products.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products.map((p) => p.sku)));
    }
  }

  async function handleGenerate() {
    if (selected.size === 0) return;
    setGenerating(true);
    setLabels([]);

    const generated: BarcodeLabel[] = [];
    for (const sku of selected) {
      const product = products.find((p) => p.sku === sku);
      if (!product) continue;

      const barcodeValue = product.barcode || sku;
      try {
        const dataUrl = await generateBarcodeDataUrl(barcodeValue, {
          width: 2,
          height: 25,
          fontSize: 10,
        });
        generated.push({
          sku,
          product_title: product.product_title,
          variant_title: product.variant_title,
          dataUrl,
        });
      } catch {
        // skip items that fail to generate
      }
    }

    setLabels(generated);
    setGenerating(false);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Barcode Labels</h1>
          <p className="text-gray-400 mt-1">
            Generate and print barcode labels for products
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-5 mb-4 flex-wrap print:hidden">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Store:</label>
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Label size:</label>
          <div className="flex gap-1">
            {LABEL_SIZES.map((size) => (
              <button
                key={size.value}
                onClick={() => setLabelSize(size.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  labelSize === size.value
                    ? "bg-white text-gray-900"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={24} className="animate-spin text-gray-400" />
        </div>
      )}

      {/* Product selection table */}
      {!loading && products.length > 0 && labels.length === 0 && (
        <>
          <div className="flex items-center justify-between mb-3 print:hidden">
            <p className="text-sm text-gray-400">
              {selected.size > 0
                ? `${selected.size} product${selected.size !== 1 ? "s" : ""} selected`
                : `${products.length} products`}
            </p>
            <button
              onClick={handleGenerate}
              disabled={selected.size === 0 || generating}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Tag size={14} />
              {generating ? "Generating..." : "Generate Labels"}
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-700/50 print:hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800/50">
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={
                        products.length > 0 &&
                        selected.size === products.length
                      }
                      onChange={toggleAll}
                      className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                    />
                  </th>
                  <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                    Product
                  </th>
                  <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                    Variant
                  </th>
                  <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                    SKU
                  </th>
                  <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                    Has Barcode
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((product, idx) => (
                  <tr
                    key={product.sku}
                    onClick={() => toggleSelect(product.sku)}
                    className={`border-b border-gray-800 hover:bg-gray-800/30 cursor-pointer ${
                      selected.has(product.sku)
                        ? "bg-emerald-900/10"
                        : idx % 2 === 0
                          ? "bg-gray-900/20"
                          : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(product.sku)}
                        onChange={() => toggleSelect(product.sku)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                      {product.product_title}
                    </td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {product.variant_title && product.variant_title !== "Default" && product.variant_title !== "Default Title" ? product.variant_title : "---"}
                    </td>
                    <td className="px-4 py-3 text-white font-mono whitespace-nowrap">
                      {product.sku}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {product.barcode ? (
                        <span className="text-emerald-400 text-xs font-medium">
                          Yes
                        </span>
                      ) : (
                        <span className="text-gray-500 text-xs">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && products.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg">No products found</p>
        </div>
      )}

      {/* Generated labels preview */}
      {labels.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4 print:hidden">
            <p className="text-sm text-gray-400">
              {labels.length} label{labels.length !== 1 ? "s" : ""} generated
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setLabels([])}
                className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer"
              >
                <Printer size={14} />
                Print
              </button>
            </div>
          </div>

          <div
            className="grid gap-2 print:gap-0"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${SIZE_STYLES[labelSize].width}, 1fr))`,
            }}
          >
            {labels.map((label) => (
              <div
                key={label.sku}
                className="bg-white rounded-lg p-2 flex flex-col items-center justify-center print:rounded-none print:border print:border-gray-300"
                style={{
                  width: SIZE_STYLES[labelSize].width,
                  height: SIZE_STYLES[labelSize].height,
                }}
              >
                <img
                  src={label.dataUrl}
                  alt={label.sku}
                  className="max-w-full max-h-[60%] object-contain"
                />
                <p className="text-[8px] text-gray-700 text-center leading-tight mt-1 truncate w-full">
                  {label.product_title}
                </p>
                {label.variant_title && label.variant_title !== "Default" && label.variant_title !== "Default Title" && (
                  <p className="text-[7px] text-gray-500 text-center leading-tight truncate w-full">
                    {label.variant_title}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:gap-0 {
            gap: 0 !important;
          }
          .print\\:rounded-none {
            border-radius: 0 !important;
          }
          .print\\:border {
            border-width: 1px !important;
          }
          .print\\:border-gray-300 {
            border-color: #d1d5db !important;
          }
        }
      `}</style>
    </div>
  );
}
