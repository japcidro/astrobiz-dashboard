"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail, Clock } from "lucide-react";
import type { Briefing, BriefingData } from "@/lib/briefings/types";

function formatPHP(n: number): string {
  return `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const positive = pct >= 0;
  return (
    <span
      className={`ml-2 text-xs font-semibold ${
        positive ? "text-green-400" : "text-red-400"
      }`}
    >
      {positive ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

function MetricRow({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: number | null;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800/60 last:border-b-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-white">
        {value}
        {delta !== undefined && <Delta pct={delta ?? null} />}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 mb-3">
        {title}
      </h3>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">{children}</div>
    </section>
  );
}

interface Props {
  id: string;
}

export function BriefingDetail({ id }: Props) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/briefings/${id}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          setError("Briefing not found.");
          return;
        }
        const data = (await r.json()) as { briefing: Briefing };
        setBriefing(data.briefing);
      })
      .catch(() => setError("Failed to load briefing."))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="text-sm text-gray-500">Loading…</div>;
  }
  if (error || !briefing) {
    return (
      <div>
        <Link
          href="/admin/briefings"
          className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4"
        >
          <ArrowLeft size={14} /> Back to briefings
        </Link>
        <p className="text-sm text-red-400">{error ?? "Not found."}</p>
      </div>
    );
  }

  const d: BriefingData = briefing.data;

  return (
    <div>
      <Link
        href="/admin/briefings"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4"
      >
        <ArrowLeft size={14} /> Back to briefings
      </Link>

      <div className="mb-6">
        <p className="text-xs text-gray-500 capitalize">{briefing.type} briefing</p>
        <h1 className="text-2xl font-bold text-white mt-1">{briefing.period_label}</h1>
        <p className="text-sm text-gray-400 mt-2">{briefing.headline}</p>
        <div className="flex items-center gap-4 mt-3 text-[11px] text-gray-600">
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {new Date(briefing.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}
          </span>
          {briefing.email_sent_at && (
            <span className="flex items-center gap-1">
              <Mail size={12} />
              Emailed to {briefing.email_recipients ?? 0} admin{briefing.email_recipients === 1 ? "" : "s"}
            </span>
          )}
          {briefing.email_error && (
            <span className="text-red-400">Email failed: {briefing.email_error}</span>
          )}
        </div>
      </div>

      {briefing.ai_summary && (
        <div className="mb-6 bg-gray-900/60 border-l-4 border-white/80 rounded-r-xl p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 mb-2">
            Summary
          </p>
          <div className="text-[15px] leading-relaxed text-gray-200 whitespace-pre-wrap">
            {briefing.ai_summary}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Financial">
          <MetricRow
            label="Revenue"
            value={formatPHP(d.revenue)}
            delta={d.revenue_delta_pct}
          />
          <MetricRow
            label="Net profit (est.)"
            value={formatPHP(d.net_profit_est)}
            delta={d.profit_delta_pct}
          />
          <MetricRow label="Orders" value={String(d.orders)} />
          <MetricRow label="Ad spend" value={formatPHP(d.ad_spend)} />
          <MetricRow label="ROAS" value={`${d.roas.toFixed(2)}x`} />
          {d.cpa > 0 && <MetricRow label="CPA" value={formatPHP(d.cpa)} />}
        </Section>

        <Section title="Operations">
          <MetricRow
            label="Unfulfilled"
            value={`${d.unfulfilled_count}${d.aging_count > 0 ? ` (${d.aging_count} aging)` : ""}`}
          />
          <MetricRow label="Fulfilled" value={String(d.fulfilled_count)} />
          {d.autopilot.paused + d.autopilot.resumed > 0 && (
            <MetricRow
              label="Autopilot"
              value={`${d.autopilot.paused} paused / ${d.autopilot.resumed} resumed`}
            />
          )}
          {d.rts.rts_count > 0 && (
            <MetricRow
              label="RTS"
              value={`${d.rts.rts_count} · ${formatPHP(d.rts.rts_value)}`}
            />
          )}
        </Section>

        {d.top_products.length > 0 && (
          <Section title="Top products">
            {d.top_products.map((p) => (
              <div key={`${p.store_name}-${p.sku ?? p.product_title}`} className="py-2 border-b border-gray-800/60 last:border-b-0">
                <p className="text-sm text-white">{p.product_title}</p>
                <p className="text-xs text-gray-500">
                  {p.store_name} · {p.units_sold} units · {formatPHP(p.revenue)}
                </p>
              </div>
            ))}
          </Section>
        )}

        {d.top_ads.length > 0 && (
          <Section title="Top ads">
            {d.top_ads.map((a) => (
              <div key={a.ad_id} className="py-2 border-b border-gray-800/60 last:border-b-0">
                <p className="text-sm text-white truncate">{a.ad_name}</p>
                <p className="text-xs text-gray-500">
                  {formatPHP(a.spend)} · {a.roas.toFixed(2)}x · {a.purchases} purchases
                </p>
              </div>
            ))}
          </Section>
        )}

        {d.worst_ads.length > 0 && (
          <Section title="Ads to review">
            {d.worst_ads.map((a) => (
              <div key={a.ad_id} className="py-2 border-b border-gray-800/60 last:border-b-0">
                <p className="text-sm text-white truncate">{a.ad_name}</p>
                <p className="text-xs text-gray-500">
                  {formatPHP(a.spend)} spent · 0 purchases
                </p>
              </div>
            ))}
          </Section>
        )}

        {d.store_breakdown.length > 0 && (
          <Section title="Stores">
            {d.store_breakdown.slice(0, 6).map((s) => (
              <MetricRow
                key={s.store_name}
                label={s.store_name}
                value={`${formatPHP(s.revenue)} · ${s.orders} orders`}
              />
            ))}
          </Section>
        )}

        {d.stock_movement.length > 0 && (
          <Section title="Stock movement">
            {d.stock_movement.map((s) => (
              <div
                key={`${s.store_name}-${s.product_title}`}
                className="py-2 border-b border-gray-800/60 last:border-b-0 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm text-white">{s.product_title}</p>
                  <p className="text-xs text-gray-500">{s.store_name}</p>
                </div>
                <span
                  className={`text-sm font-semibold ${
                    s.delta > 0 ? "text-green-400" : "text-orange-400"
                  }`}
                >
                  {s.delta > 0 ? "+" : ""}
                  {s.delta}
                </span>
              </div>
            ))}
          </Section>
        )}

        {d.team_hours.length > 0 && (
          <Section title="Team hours">
            {d.team_hours.map((t) => (
              <MetricRow key={t.role} label={t.role} value={`${t.hours}h`} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
