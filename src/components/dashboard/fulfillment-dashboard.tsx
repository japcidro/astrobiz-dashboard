"use client";

import { useEffect, useState } from "react";
import { Tile } from "@/components/ui/tile";
import { LinkButton } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NeedsYou } from "./needs-you";

interface Props {
  employeeName: string;
  hoursToday: string;
  hasActiveSession: boolean;
}

interface InventorySummary {
  out_of_stock_count: number;
  low_stock_count: number;
  total_units: number;
  total_products: number;
}

interface UnfulfilledOrder {
  order_number: string;
  age_days: number;
}

interface TodayData {
  pack_queue: number;
  my_verified_today: number;
  team_verified_today: number;
  low_runway_skus: Array<{
    product_title: string;
    sku: string | null;
    stock: number;
    runway_days: number;
    velocity_per_day: number;
    store_name: string;
  }>;
}

export function FulfillmentDashboard({ hasActiveSession }: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [fulfillmentLoading, setFulfillmentLoading] = useState(true);
  const [unfulfilledOrders, setUnfulfilledOrders] = useState<UnfulfilledOrder[]>([]);
  const [today, setToday] = useState<TodayData | null>(null);

  useEffect(() => {
    import("@/lib/client-cache").then(({ cachedFetch }) => {
      cachedFetch("/api/shopify/inventory?store=ALL")
        .then(({ data }) =>
          setSummary((data as Record<string, unknown>)?.summary as typeof summary ?? null)
        )
        .catch(() => setSummary(null))
        .finally(() => setLoading(false));

      cachedFetch("/api/shopify/fulfillment")
        .then(({ data }) => {
          const orders = (data as Record<string, unknown>)?.orders as UnfulfilledOrder[] ?? [];
          setUnfulfilledOrders(orders);
        })
        .catch(() => setUnfulfilledOrders([]))
        .finally(() => setFulfillmentLoading(false));
    });

    fetch("/api/fulfillment/today", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setToday(d);
      })
      .catch(() => {});
  }, []);

  const aging = unfulfilledOrders.filter((o) => o.age_days >= 3).length;
  const outOfStock = summary?.out_of_stock_count ?? 0;
  const lowStock = summary?.low_stock_count ?? 0;
  const lowRunway = today?.low_runway_skus ?? [];

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-base text-fg">Today</h2>
        <div className="grid grid-cols-2 gap-sys md:grid-cols-3 lg:grid-cols-6">
          <Tile
            label="Pack queue"
            value={String(today?.pack_queue ?? 0)}
            delta="ready to verify"
            loading={!today}
          />
          <Tile
            label="Verified by me"
            value={String(today?.my_verified_today ?? 0)}
            delta={today ? `team ${today.team_verified_today}` : undefined}
            loading={!today}
          />
          <Tile
            label="Unfulfilled"
            value={String(unfulfilledOrders.length)}
            loading={fulfillmentLoading}
          />
          <Tile
            label="Aging 3+ days"
            value={String(aging)}
            delta={aging > 0 ? "pack these first" : undefined}
            tone="bad"
            hot={aging > 0}
            loading={fulfillmentLoading}
          />
          <Tile
            label="Out of stock"
            value={String(outOfStock)}
            delta={summary ? `of ${summary.total_products} products` : undefined}
            tone="bad"
            hot={outOfStock > 0}
            loading={loading}
          />
          <Tile
            label="Low stock"
            value={String(lowStock)}
            delta={summary ? `${summary.total_units} units in all` : undefined}
            tone={lowStock > 0 ? "warn" : "neutral"}
            loading={loading}
          />
        </div>
      </section>

      {lowRunway.length > 0 && (
        <section>
          <h2 className="mb-3 text-base text-fg">Running out soon</h2>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Product</TableHeader>
                <TableHeader>Store</TableHeader>
                <TableHeader num>Per day</TableHeader>
                <TableHeader num>In stock</TableHeader>
                <TableHeader num>Days left</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {lowRunway.map((sku) => (
                <TableRow key={`${sku.store_name}-${sku.sku}`}>
                  <TableCell className="max-w-xs">
                    <p className="truncate">{sku.product_title}</p>
                    {sku.sku && <p className="truncate font-mono text-xs text-muted">{sku.sku}</p>}
                  </TableCell>
                  <TableCell className="text-muted">{sku.store_name}</TableCell>
                  <TableCell num>{sku.velocity_per_day.toFixed(1)}</TableCell>
                  <TableCell num>{sku.stock}</TableCell>
                  <TableCell num className={sku.runway_days < 3 ? "text-bad" : "text-warn"}>
                    {sku.runway_days}d
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <NeedsYou
        loading={loading || fulfillmentLoading}
        items={[
          {
            label: "Orders aging 3+ days",
            count: aging,
            href: "/fulfillment/pick-pack",
            severity: "danger",
          },
          {
            label: "Out of stock products",
            count: outOfStock,
            href: "/fulfillment/inventory",
            severity: "danger",
          },
          {
            label: "Unfulfilled orders waiting",
            count: unfulfilledOrders.length,
            href: "/fulfillment/pick-pack",
            severity: "warning",
          },
          {
            label: "Low stock products (under 10)",
            count: lowStock,
            href: "/fulfillment/inventory",
            severity: "warning",
          },
          {
            label: "You are not clocked in",
            count: hasActiveSession ? 0 : 1,
            href: "/time-tracker",
            severity: "info",
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <LinkButton href="/fulfillment/pick-pack/verify">Start verifying</LinkButton>
        <LinkButton href="/fulfillment/pick-pack" variant="secondary">
          Pick &amp; pack
        </LinkButton>
        <LinkButton href="/fulfillment/inventory" variant="ghost">
          Inventory
        </LinkButton>
      </div>
    </div>
  );
}
