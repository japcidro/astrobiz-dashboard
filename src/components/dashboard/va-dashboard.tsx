"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Tile } from "@/components/ui/tile";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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

interface OrdersSummary {
  total_orders: number;
  unfulfilled_count: number;
  fulfilled_count: number;
  aging_warning_count: number;
  aging_danger_count: number;
}

interface StoreBreakdown {
  store_name: string;
  total: number;
  unfulfilled: number;
  aging: number;
  fulfilled: number;
}

export function VADashboard({ hasActiveSession }: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<OrdersSummary | null>(null);
  const [stores, setStores] = useState<StoreBreakdown[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);

  useEffect(() => {
    import("@/lib/client-cache").then(({ cachedFetch }) =>
      cachedFetch("/api/shopify/orders?date_filter=today&store=ALL")
        .then(({ data }) =>
          setSummary((data as Record<string, unknown>)?.summary as typeof summary ?? null)
        )
        .catch(() => setSummary(null))
        .finally(() => setLoading(false))
    );

    fetch("/api/va/today", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setStores(d.stores ?? []);
      })
      .catch(() => {})
      .finally(() => setStoresLoading(false));
  }, []);

  const agingTotal =
    (summary?.aging_warning_count ?? 0) + (summary?.aging_danger_count ?? 0);
  const total = summary?.total_orders ?? 0;
  const fulfilled = summary?.fulfilled_count ?? 0;
  const unfulfilled = summary?.unfulfilled_count ?? 0;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-base text-fg">Today&apos;s orders</h2>
        <div className="grid grid-cols-2 gap-sys md:grid-cols-4">
          <Tile label="Orders today" value={String(total)} loading={loading} />
          <Tile
            label="Unfulfilled"
            value={String(unfulfilled)}
            delta={
              total > 0 ? `${Math.round((unfulfilled / total) * 100)}% of today` : undefined
            }
            loading={loading}
          />
          <Tile
            label="Aging 3+ days"
            value={String(agingTotal)}
            delta={agingTotal > 0 ? "call these first" : undefined}
            tone="bad"
            hot={agingTotal > 0}
            loading={loading}
          />
          <Tile
            label="Fulfilled"
            value={String(fulfilled)}
            delta={
              total > 0 ? `${Math.round((fulfilled / total) * 100)}% of today` : undefined
            }
            tone="good"
            loading={loading}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base text-fg">By store</h2>
        {storesLoading ? (
          <div className="space-y-2">
            <div className="h-9 animate-pulse rounded-control bg-raised" />
            <div className="h-9 animate-pulse rounded-control bg-raised" />
          </div>
        ) : stores.length === 0 ? (
          <EmptyState title="No orders today">
            Orders show up here, store by store, as they come in.
          </EmptyState>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Store</TableHeader>
                <TableHeader num>Total</TableHeader>
                <TableHeader num>Unfulfilled</TableHeader>
                <TableHeader num>Aging</TableHeader>
                <TableHeader num>Fulfilled</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {stores.map((store) => (
                <TableRow key={store.store_name}>
                  <TableCell>
                    <Link
                      href={`/va/orders?store=${encodeURIComponent(store.store_name)}`}
                      className="text-fg hover:text-accent"
                    >
                      {store.store_name}
                    </Link>
                  </TableCell>
                  <TableCell num>{store.total}</TableCell>
                  <TableCell num className={store.unfulfilled > 0 ? "text-warn" : "text-dim"}>
                    {store.unfulfilled}
                  </TableCell>
                  <TableCell num className={store.aging > 0 ? "text-bad" : "text-dim"}>
                    {store.aging}
                  </TableCell>
                  <TableCell num className="text-muted">
                    {store.fulfilled}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <NeedsYou
        loading={loading}
        items={[
          {
            label: "Orders aging 3+ days",
            count: agingTotal,
            href: "/va/orders",
            severity: "danger",
          },
          {
            label: "Unfulfilled orders",
            count: unfulfilled,
            href: "/va/orders",
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
        <LinkButton href="/va/orders">Open orders &amp; parcels</LinkButton>
        <LinkButton href="/time-tracker" variant="ghost">
          Time tracker
        </LinkButton>
      </div>
    </div>
  );
}
