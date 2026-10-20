"use client";

import { useEffect, useState } from "react";
import { cachedFetch, formatLastRefreshed } from "@/lib/client-cache";
import { Tile } from "@/components/ui/tile";
import { NeedsYou } from "./needs-you";
import { AlertsFeed } from "@/components/alerts/alerts-feed";

interface Props {
  employeeName: string;
  teamTotalHours: number;
  teamNotClockedIn: number;
}

interface OrdersSummary {
  total_revenue: number;
  total_orders: number;
  unfulfilled_count: number;
  fulfilled_count: number;
  aging_warning_count: number;
  aging_danger_count: number;
}

interface AdsTotals {
  spend: number;
  roas: number;
  cpa: number;
  purchases: number;
}

interface InventorySummary {
  total_units: number;
  total_products: number;
  out_of_stock_count: number;
  low_stock_count: number;
}

function formatCurrency(num: number): string {
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatHours(seconds: number): string {
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function AdminDashboard({ teamTotalHours, teamNotClockedIn }: Props) {
  const [loading, setLoading] = useState(true);
  const [todayOrders, setTodayOrders] = useState<OrdersSummary | null>(null);
  const [monthOrders, setMonthOrders] = useState<OrdersSummary | null>(null);
  const [todayAds, setTodayAds] = useState<AdsTotals | null>(null);
  const [monthAds, setMonthAds] = useState<AdsTotals | null>(null);
  const [inventory, setInventory] = useState<InventorySummary | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");

  useEffect(() => {
    Promise.allSettled([
      cachedFetch("/api/shopify/orders?date_filter=today&store=ALL"),
      cachedFetch("/api/shopify/orders?date_filter=this_month&store=ALL"),
      cachedFetch("/api/facebook/all-ads?date_preset=today"),
      cachedFetch("/api/facebook/all-ads?date_preset=this_month"),
      cachedFetch("/api/shopify/inventory?store=ALL"),
    ]).then(([todayOrd, monthOrd, todayAd, monthAd, inv]) => {
      const toData = todayOrd.status === "fulfilled" ? todayOrd.value : null;
      const moData = monthOrd.status === "fulfilled" ? monthOrd.value : null;
      const taData = todayAd.status === "fulfilled" ? todayAd.value : null;
      const maData = monthAd.status === "fulfilled" ? monthAd.value : null;
      const ivData = inv.status === "fulfilled" ? inv.value : null;

      setTodayOrders((toData?.data as Record<string, unknown>)?.summary as OrdersSummary ?? null);
      setMonthOrders((moData?.data as Record<string, unknown>)?.summary as OrdersSummary ?? null);
      setTodayAds((taData?.data as Record<string, unknown>)?.totals as AdsTotals ?? null);
      setMonthAds((maData?.data as Record<string, unknown>)?.totals as AdsTotals ?? null);
      setInventory((ivData?.data as Record<string, unknown>)?.summary as InventorySummary ?? null);

      // Find the oldest timestamp for "last refreshed"
      const timestamps = [todayOrd, monthOrd, todayAd, monthAd, inv]
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<{ timestamp: number }>).value.timestamp);
      if (timestamps.length > 0) {
        setLastRefreshed(formatLastRefreshed(Math.min(...timestamps)));
      }

      setLoading(false);
    });

    // Update "last refreshed" text every 30s
    const interval = setInterval(() => {
      // Re-read from cache timestamps
      setLastRefreshed((prev) => prev); // trigger re-render handled by interval
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const agingTotal =
    (todayOrders?.aging_warning_count ?? 0) +
    (todayOrders?.aging_danger_count ?? 0);

  const outOfStock = inventory?.out_of_stock_count ?? 0;
  const lowStock = inventory?.low_stock_count ?? 0;
  const monthRoas = monthAds?.roas ?? 0;

  return (
    <div className="space-y-8">
      {/* Decision cockpit: the action feed at the top */}
      <AlertsFeed limit={5} />

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-base text-fg">Today</h2>
          {lastRefreshed && (
            <p className="text-xs text-dim">Refreshed {lastRefreshed}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-sys md:grid-cols-3 lg:grid-cols-5">
          <Tile
            label="Revenue today"
            value={formatCurrency(todayOrders?.total_revenue ?? 0)}
            loading={loading}
          />
          <Tile
            label="Orders today"
            value={String(todayOrders?.total_orders ?? 0)}
            delta={
              todayOrders ? `${todayOrders.fulfilled_count} fulfilled` : undefined
            }
            loading={loading}
          />
          <Tile
            label="Ad spend today"
            value={formatCurrency(todayAds?.spend ?? 0)}
            delta={todayAds ? `ROAS ${todayAds.roas.toFixed(2)}x` : undefined}
            tone={todayAds && todayAds.spend > 0 && todayAds.roas < 1 ? "bad" : "neutral"}
            loading={loading}
          />
          <Tile
            label="Unfulfilled"
            value={String(todayOrders?.unfulfilled_count ?? 0)}
            delta={agingTotal > 0 ? `${agingTotal} aging 3+ days` : undefined}
            tone="bad"
            hot={agingTotal > 0}
            loading={loading}
          />
          <Tile
            label="Team hours"
            value={formatHours(teamTotalHours)}
            delta={
              teamNotClockedIn > 0
                ? `${teamNotClockedIn} not clocked in`
                : "everyone clocked in"
            }
            tone={teamNotClockedIn > 0 ? "warn" : "good"}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base text-fg">This month</h2>
        <div className="grid grid-cols-2 gap-sys md:grid-cols-3 lg:grid-cols-5">
          <Tile
            label="Revenue"
            value={formatCurrency(monthOrders?.total_revenue ?? 0)}
            loading={loading}
          />
          <Tile
            label="Orders"
            value={String(monthOrders?.total_orders ?? 0)}
            delta={
              monthOrders ? `${monthOrders.fulfilled_count} fulfilled` : undefined
            }
            loading={loading}
          />
          <Tile
            label="Ad spend"
            value={formatCurrency(monthAds?.spend ?? 0)}
            delta={monthAds ? `${monthAds.purchases} purchases` : undefined}
            loading={loading}
          />
          <Tile
            label="ROAS"
            value={`${monthRoas.toFixed(2)}x`}
            delta={monthAds ? `CPA ${formatCurrency(monthAds.cpa)}` : undefined}
            tone={monthAds && monthAds.spend > 0 && monthRoas < 1 ? "bad" : "neutral"}
            loading={loading}
          />
          <Tile
            label="Inventory"
            value={String(inventory?.total_units ?? 0)}
            unit="units"
            delta={
              outOfStock > 0
                ? `${outOfStock} out of stock`
                : inventory
                  ? `${inventory.total_products} products`
                  : undefined
            }
            tone={outOfStock > 0 ? "bad" : "neutral"}
            hot={outOfStock > 0}
            loading={loading}
          />
        </div>
      </section>

      <NeedsYou
        loading={loading}
        items={[
          {
            label: "Orders unfulfilled 3+ days",
            count: agingTotal,
            href: "/va/orders",
            severity: "danger",
          },
          {
            label: "Out of stock products",
            count: outOfStock,
            href: "/fulfillment/inventory",
            severity: "danger",
          },
          {
            label: "Low stock products",
            count: lowStock,
            href: "/fulfillment/inventory",
            severity: "warning",
          },
          {
            label: "Team not clocked in",
            count: teamNotClockedIn,
            href: "/admin/attendance",
            severity: "info",
          },
        ]}
      />
    </div>
  );
}
