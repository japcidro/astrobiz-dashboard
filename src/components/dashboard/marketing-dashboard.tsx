"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Tile } from "@/components/ui/tile";
import { Pill, type PillTone } from "@/components/ui/pill";
import { Tag } from "@/components/ui/tag";
import { Note } from "@/components/ui/note";
import { EmptyState } from "@/components/ui/empty-state";
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

interface AdsTotals {
  spend: number;
  roas: number;
  cpa: number;
  purchases: number;
}

interface QueueItem {
  ad_id: string;
  ad_name: string;
  campaign_name: string | null;
  spend_7d: number;
  roas_7d: number;
  purchases_7d: number;
  reason: "scaling_winner" | "fading_winner" | "new_winner" | "dead_weight";
  reason_label: string;
}

interface AutopilotRow {
  id: string;
  action: string;
  rule_matched: string | null;
  ad_name: string | null;
  spend: number | null;
  created_at: string;
}

function formatCurrency(num: number): string {
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Why an ad is in the queue, as a status tone: good to scale, bad to pause. */
function queueTone(reason: QueueItem["reason"]): PillTone {
  switch (reason) {
    case "scaling_winner":
      return "good";
    case "fading_winner":
      return "warn";
    case "new_winner":
      return "info";
    case "dead_weight":
      return "bad";
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}

export function MarketingDashboard({ hasActiveSession }: Props) {
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState<AdsTotals | null>(null);
  const [error, setError] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [autopilot, setAutopilot] = useState<AutopilotRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

  useEffect(() => {
    import("@/lib/client-cache").then(({ cachedFetch }) =>
      cachedFetch("/api/facebook/all-ads?date_preset=today")
        .then(({ data }) =>
          setTotals((data as Record<string, unknown>)?.totals as typeof totals ?? null)
        )
        .catch(() => {
          setTotals(null);
          setError(true);
        })
        .finally(() => setLoading(false))
    );

    fetch("/api/marketing/action-queue", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setQueue(d.queue ?? []);
        setAutopilot(d.autopilot_last_24h ?? []);
      })
      .catch(() => {})
      .finally(() => setQueueLoading(false));
  }, []);

  const roas = totals?.roas ?? 0;
  const losing = !!totals && totals.spend > 0 && roas < 1;
  const count = (reason: QueueItem["reason"]) =>
    queue.filter((item) => item.reason === reason).length;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-base text-fg">Today&apos;s ads</h2>
        {error && !loading ? (
          <Note tone="bad">
            Ad data is unavailable. Check the Facebook token configuration.
          </Note>
        ) : (
          <div className="grid grid-cols-2 gap-sys md:grid-cols-4">
            <Tile
              label="Ad spend"
              value={formatCurrency(totals?.spend ?? 0)}
              loading={loading}
            />
            <Tile
              label="ROAS"
              value={`${roas.toFixed(2)}x`}
              delta={losing ? "below break-even" : undefined}
              tone="bad"
              hot={losing}
              loading={loading}
            />
            <Tile
              label="CPA"
              value={formatCurrency(totals?.cpa ?? 0)}
              loading={loading}
            />
            <Tile
              label="Purchases"
              value={String(totals?.purchases ?? 0)}
              loading={loading}
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base text-fg">Action queue</h2>
        {queueLoading ? (
          <div className="space-y-2">
            <div className="h-9 animate-pulse rounded-control bg-raised" />
            <div className="h-9 animate-pulse rounded-control bg-raised" />
          </div>
        ) : queue.length === 0 ? (
          <EmptyState title="No ads need attention right now">
            The queue surfaces scaling winners, fading ads and dead weight from 7-day data.
          </EmptyState>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Ad</TableHeader>
                <TableHeader>Why</TableHeader>
                <TableHeader num>7d spend</TableHeader>
                <TableHeader num>7d ROAS</TableHeader>
                <TableHeader num>Purchases</TableHeader>
                <TableHeader />
              </TableRow>
            </TableHead>
            <TableBody>
              {queue.map((item) => (
                <TableRow key={item.ad_id}>
                  <TableCell className="max-w-xs">
                    <Link
                      href={`/marketing/ads?ad_id=${encodeURIComponent(item.ad_id)}`}
                      className="block truncate text-fg hover:text-accent"
                    >
                      {item.ad_name}
                    </Link>
                    {item.campaign_name && (
                      <p className="truncate text-xs text-muted">{item.campaign_name}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Pill tone={queueTone(item.reason)}>{item.reason_label}</Pill>
                  </TableCell>
                  <TableCell num>{formatCurrency(item.spend_7d)}</TableCell>
                  <TableCell num>{item.roas_7d.toFixed(2)}x</TableCell>
                  <TableCell num>{item.purchases_7d}</TableCell>
                  <TableCell num>
                    <Link
                      href={`/marketing/ads?ad_id=${encodeURIComponent(item.ad_id)}`}
                      className="text-xs text-muted hover:text-accent"
                    >
                      Open →
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {autopilot.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-base text-fg">Autopilot, last 24h</h2>
            <Link
              href="/marketing/ads?tab=autopilot"
              className="text-xs text-muted hover:text-fg"
            >
              View log →
            </Link>
          </div>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Action</TableHeader>
                <TableHeader>Ad</TableHeader>
                <TableHeader className="hidden sm:table-cell">Rule</TableHeader>
                <TableHeader num>When</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {autopilot.slice(0, 5).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Pill tone={row.action === "paused" ? "bad" : "good"}>
                      {row.action}
                    </Pill>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {row.ad_name ?? "Unknown ad"}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {row.rule_matched && <Tag>{row.rule_matched}</Tag>}
                  </TableCell>
                  <TableCell num className="text-muted">
                    {timeAgo(row.created_at)} ago
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <NeedsYou
        loading={queueLoading}
        items={[
          {
            label: "Dead-weight ads to pause",
            count: count("dead_weight"),
            href: "/marketing/ads",
            severity: "danger",
          },
          {
            label: "Fading winners to check",
            count: count("fading_winner"),
            href: "/marketing/ads",
            severity: "warning",
          },
          {
            label: "Winners ready to scale",
            count: count("scaling_winner") + count("new_winner"),
            href: "/marketing/ads",
            severity: "info",
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
        <LinkButton href="/marketing/ads">Ad performance</LinkButton>
        <LinkButton href="/marketing/create" variant="secondary">
          Create an ad
        </LinkButton>
        <LinkButton href="/time-tracker" variant="ghost">
          Time tracker
        </LinkButton>
      </div>
    </div>
  );
}
