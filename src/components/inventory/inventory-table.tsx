import { ChevronUp, ChevronDown } from "lucide-react";
import type { InventoryRow } from "@/lib/shopify/types";

interface Props {
  rows: InventoryRow[];
  sortKey: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  isAdmin: boolean;
  onSelectProduct: (productId: number) => void;
}

const ALL_COLUMNS: { key: string; label: string; adminOnly?: boolean }[] = [
  { key: "product_title", label: "Product" },
  { key: "variant_title", label: "Variant" },
  { key: "sku", label: "SKU" },
  { key: "store_name", label: "Store" },
  { key: "stock", label: "Stock" },
  { key: "price", label: "Price (₱)", adminOnly: true },
  { key: "product_type", label: "Type" },
];

function formatCurrency(val: string) {
  const num = parseFloat(val);
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StockBadge({ stock }: { stock: number }) {
  if (stock === 0) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-900/30 text-red-400">
        Out of stock
      </span>
    );
  }
  if (stock >= 1 && stock <= 9) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-yellow-900/30 text-yellow-400">
        Low ({stock})
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-900/30 text-green-400">
      {stock}
    </span>
  );
}

export function InventoryTable({ rows, sortKey, sortDir, onSort, isAdmin, onSelectProduct }: Props) {
  const COLUMNS = ALL_COLUMNS.filter((c) => !c.adminOnly || isAdmin);

  if (rows.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg">No products found</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-700/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-800/50">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => onSort(col.key)}
                className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap cursor-pointer hover:text-white transition-colors select-none"
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key ? (
                    sortDir === "asc" ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={`${row.variant_id}-${row.store_id}`}
              onClick={() => onSelectProduct(row.product_id)}
              className={`border-b border-gray-800 hover:bg-gray-800/30 cursor-pointer ${
                idx % 2 === 0 ? "bg-gray-900/20" : ""
              }`}
            >
              <td className="px-4 py-3 font-medium text-white whitespace-nowrap">
                {row.product_title}
              </td>
              <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                {row.variant_title === "Default Title" ? "Default" : row.variant_title}
              </td>
              <td className="px-4 py-3 text-gray-300 whitespace-nowrap font-mono text-xs">
                {row.sku || "—"}
              </td>
              <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                {row.store_name}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <StockBadge stock={row.stock} />
              </td>
              {isAdmin && (
                <td className="px-4 py-3 text-white font-medium whitespace-nowrap">
                  {formatCurrency(row.price)}
                </td>
              )}
              <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                {row.product_type || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
