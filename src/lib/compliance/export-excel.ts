// Client-side .xlsx builders for the Compliance tab. Uses SheetJS (xlsx),
// already a project dependency. Each export produces one workbook the
// accountant can open directly in Excel / Google Sheets.

import * as XLSX from "xlsx";
import type { AdSpendRow } from "@/app/api/compliance/ad-spend/route";
import type {
  MovementRow,
  SalesOutRow,
  SnapshotRow,
} from "@/app/api/compliance/stock-movement/route";

function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

function autoWidth(rows: Record<string, unknown>[]): { wch: number }[] {
  if (rows.length === 0) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((key) => {
    const maxLen = Math.max(
      key.length,
      ...rows.map((r) => String(r[key] ?? "").length)
    );
    return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
  });
}

function sheetFrom(rows: Record<string, unknown>[]): XLSX.WorkSheet {
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = autoWidth(rows);
  return ws;
}

export function exportAdSpend(
  rows: AdSpendRow[],
  range: { from: string; to: string }
) {
  const formatted = rows.map((r) => ({
    Date: r.date,
    "Ad Account": r.account,
    Campaign: r.campaign,
    "Ad Set": r.adset,
    "Spend (PHP)": Math.round(r.spend * 100) / 100,
    Impressions: r.impressions,
    Reach: r.reach,
  }));

  const total = rows.reduce((sum, r) => sum + r.spend, 0);
  formatted.push({
    Date: "",
    "Ad Account": "",
    Campaign: "",
    "Ad Set": "TOTAL",
    "Spend (PHP)": Math.round(total * 100) / 100,
    Impressions: rows.reduce((s, r) => s + r.impressions, 0),
    Reach: rows.reduce((s, r) => s + r.reach, 0),
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(formatted), "FB Ad Spend");
  downloadWorkbook(wb, `Ad_Spend_${range.from}_to_${range.to}.xlsx`);
}

export function exportStockMovement(
  data: {
    movements: MovementRow[];
    salesOut: SalesOutRow[];
    snapshot: SnapshotRow[];
  },
  range: { from: string; to: string }
) {
  const wb = XLSX.utils.book_new();

  const movementRows = data.movements.map((m) => ({
    Date: m.date,
    Store: m.store,
    SKU: m.sku,
    Product: m.product,
    Type: m.type,
    Reason: m.reason,
    "Prev Qty": m.previous_qty,
    "New Qty": m.new_qty,
    "Change": m.change_qty,
    "Performed By": m.performed_by,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom(movementRows.length ? movementRows : [{ Note: "No adjustments in range" }]),
    "Stock Adjustments"
  );

  const salesRows = data.salesOut.map((s) => ({
    Date: s.date,
    Store: s.store,
    SKU: s.sku,
    Product: s.product,
    "Units Sold (Out)": s.units_sold,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom(salesRows.length ? salesRows : [{ Note: "No sales in range" }]),
    "Sales Out"
  );

  const snapshotRows = data.snapshot.map((s) => ({
    Store: s.store,
    SKU: s.sku,
    Product: s.product,
    Variant: s.variant,
    "Current On-Hand": s.current_qty,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom(snapshotRows.length ? snapshotRows : [{ Note: "No stock data" }]),
    "Current Stock"
  );

  downloadWorkbook(wb, `Stock_Movement_${range.from}_to_${range.to}.xlsx`);
}
