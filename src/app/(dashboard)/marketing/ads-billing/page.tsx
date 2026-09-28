"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CreditCard,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Wallet,
  Store,
  Loader2,
  BellRing,
  Check,
} from "lucide-react";
import { cachedFetch, formatLastRefreshed } from "@/lib/client-cache";
import type {
  BillingAccount,
  BillingResponse,
  StatusTone,
} from "@/lib/facebook/billing";
import {
  thresholdStatus,
  type ThresholdSetting,
  type ThresholdStage,
} from "@/lib/facebook/billing-threshold";

const BILLING_URL = "/api/facebook/billing";
const CLIENT_TTL_MS = 5 * 60 * 1000;

const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pesoWhole = (n: number) =>
  `₱${Math.round(n).toLocaleString("en-PH")}`;

const TONE_BADGE: Record<StatusTone, string> = {
  ok: "text-green-400 bg-green-900/50 border-green-800/60",
  warn: "text-orange-300 bg-orange-900/50 border-orange-800/60",
  bad: "text-red-300 bg-red-900/50 border-red-800/60",
  muted: "text-gray-400 bg-gray-700/50 border-gray-600/60",
};

const TONE_CARD: Record<StatusTone, string> = {
  ok: "border-gray-700/50",
  warn: "border-orange-700/60",
  bad: "border-red-700/70 shadow-[0_0_0_1px_rgba(239,68,68,0.25)]",
  muted: "border-gray-700/50 opacity-80",
};

function StatusBadge({ account }: { account: BillingAccount }) {
  const { status } = account;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold tracking-wide ${TONE_BADGE[status.tone]}`}
    >
      {status.tone === "ok" ? (
        <CheckCircle2 size={12} />
      ) : (
        <AlertTriangle size={12} />
      )}
      {status.label.replace(/_/g, " ")}
    </span>
  );
}

const STAGE_BAR: Record<ThresholdStage | "none", string> = {
  none: "bg-emerald-500",
  approaching: "bg-orange-400",
  reached: "bg-red-500",
};

/** Balance against the billing limit — the bar the email is about. */
function ThresholdBar({ account }: { account: BillingAccount }) {
  const t = account.threshold;
  const stage = t.stage ?? "none";
  const width = Math.max(2, Math.min(100, t.pct));
  return (
    <div className="mt-2">
      <div className="h-1.5 w-full rounded-full bg-gray-700/70 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${STAGE_BAR[stage]}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <p
        className={`text-[11px] mt-1 ${
          stage === "reached"
            ? "text-red-300"
            : stage === "approaching"
              ? "text-orange-300"
              : "text-gray-500"
        }`}
      >
        {Math.round(t.pct)}% of {pesoWhole(t.limit)} limit
        {stage === "reached"
          ? " · Meta is charging the card"
          : stage === "approaching"
            ? ` · ${pesoWhole(t.remaining)} to the charge`
            : ` · email at ${pesoWhole(t.alert_at)}`}
      </p>
    </div>
  );
}

const THRESHOLDS_URL = "/api/facebook/billing/thresholds";

/**
 * Where the limit lives. Meta does not tell the API what an account's
 * payment threshold is, so the reader sets it here and the alert cron
 * emails at the warning level.
 */
function ThresholdEditor({
  account,
  onSaved,
}: {
  account: BillingAccount;
  onSaved: (accountId: string, setting: ThresholdSetting) => void;
}) {
  const [limit, setLimit] = useState(String(account.threshold.limit));
  const [alertAt, setAlertAt] = useState(String(account.threshold.alert_at));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLimit(String(account.threshold.limit));
    setAlertAt(String(account.threshold.alert_at));
  }, [account.threshold.limit, account.threshold.alert_at]);

  const dirty =
    Number(limit) !== account.threshold.limit ||
    Number(alertAt) !== account.threshold.alert_at;

  const save = async () => {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await fetch(THRESHOLDS_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: account.id,
          limit: Number(limit),
          alert_at: Number(alertAt),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        threshold?: ThresholdSetting;
      };
      if (!res.ok || !json.threshold) throw new Error(json.error ?? "Could not save");
      onSaved(account.id, json.threshold);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    hint: string
  ) => (
    <label className="flex-1 min-w-[120px]">
      <span className="block text-[10px] uppercase tracking-wider text-gray-500 font-medium">
        {label}
      </span>
      <span className="mt-1 flex items-center rounded-md bg-gray-900/60 border border-gray-700/60 focus-within:border-emerald-600/60">
        <span className="pl-2 text-xs text-gray-500">₱</span>
        <input
          type="number"
          min={1}
          step={1000}
          inputMode="numeric"
          value={value}
          onChange={(e) => set(e.target.value)}
          className="w-full bg-transparent px-1.5 py-1.5 text-sm text-white outline-none"
          aria-label={label}
        />
      </span>
      <span className="block text-[10px] text-gray-500 mt-0.5">{hint}</span>
    </label>
  );

  return (
    <div className="rounded-lg border border-gray-700/50 bg-gray-900/30 p-3">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-2 flex items-center gap-1">
        <BellRing size={11} /> Billing limit &amp; email warning
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {field("Meta charges at", limit, setLimit, "Payment threshold on Meta's Billing page")}
        {field("Email me at", alertAt, setAlertAt, "Urgent email once the balance gets here")}
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40 disabled:hover:bg-emerald-700 mb-[18px]"
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : saved ? (
            <Check size={13} />
          ) : null}
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      {err && <p className="text-xs text-red-300 mt-2">{err}</p>}
    </div>
  );
}

function AccountCard({
  account,
  onThresholdSaved,
}: {
  account: BillingAccount;
  onThresholdSaved: (accountId: string, setting: ThresholdSetting) => void;
}) {
  const { status } = account;
  const primaryIsPay = status.needsPayment;

  return (
    <div
      className={`bg-gray-800/50 border rounded-xl p-5 flex flex-col gap-4 ${TONE_CARD[status.tone]}`}
    >
      {/* Name + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white truncate" title={account.name}>
            {account.name}
          </h2>
          <p className="text-xs text-gray-500 font-mono mt-0.5">{account.id}</p>
        </div>
        <StatusBadge account={account} />
      </div>

      {/* Stores running here */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5 flex items-center gap-1">
          <Store size={11} /> Stores running here
        </p>
        {account.stores.length === 0 ? (
          <p className="text-xs text-gray-500">
            No store attributed — no ads named for a brand ran here in the last 7 days.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {account.stores.map((s) => (
              <span
                key={s.store}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-700/60 text-xs text-gray-200"
                title={
                  s.source === "defaults"
                    ? "Set as this store's ad account in Create Ad defaults"
                    : `${s.ads} ad${s.ads === 1 ? "" : "s"} in the last 7 days`
                }
              >
                <span className="font-medium">{s.store}</span>
                {s.spend > 0 ? (
                  <span className="text-gray-400">{pesoWhole(s.spend)} / 7d</span>
                ) : (
                  <span className="text-gray-500">{s.source === "defaults" ? "default" : "no spend"}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Money */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-900/50 rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
            {status.needsPayment ? "Unpaid balance" : "Current balance"}
          </p>
          <p
            className={`text-xl font-bold mt-1 ${
              status.needsPayment ? "text-red-300" : "text-white"
            }`}
          >
            {peso(account.balance)}
          </p>
          {status.needsPayment ? (
            <p className="text-[11px] text-red-400/80 mt-0.5">Ads stop until this is paid</p>
          ) : (
            <ThresholdBar account={account} />
          )}
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
            Payment method
          </p>
          <p className="text-sm font-semibold text-white mt-1 truncate">
            {account.funding?.display ?? "None on file"}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5 truncate">
            {account.funding?.type ?? "Add one in payment settings"}
            {account.is_prepay ? " · prepaid" : ""}
          </p>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
            Lifetime spend
          </p>
          <p className="text-sm font-semibold text-white mt-1">{pesoWhole(account.amount_spent)}</p>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
            Ad credits left
          </p>
          <p className="text-sm font-semibold text-white mt-1">
            {peso(account.funding?.credits_remaining ?? 0)}
          </p>
          {account.spend_cap > 0 && (
            <p className="text-[11px] text-gray-500 mt-0.5">
              Spend cap {pesoWhole(account.spend_cap)}
            </p>
          )}
        </div>
      </div>

      <ThresholdEditor account={account} onSaved={onThresholdSaved} />

      {/* What it means */}
      <div
        className={`rounded-lg p-3 text-sm ${
          status.tone === "ok"
            ? "bg-green-900/20 text-green-200/90"
            : status.tone === "warn"
              ? "bg-orange-900/20 text-orange-100/90"
              : status.tone === "bad"
                ? "bg-red-900/20 text-red-100/90"
                : "bg-gray-700/30 text-gray-300"
        }`}
      >
        <p>{status.headline}</p>
        {status.action && <p className="mt-1 text-xs opacity-80">{status.action}</p>}
        {account.disable_reason !== "NONE" && (
          <p className="mt-1 text-[11px] font-mono opacity-60">
            disable_reason: {account.disable_reason}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mt-auto">
        <a
          href={account.links.pay}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
            primaryIsPay
              ? "bg-red-600 hover:bg-red-500 text-white"
              : "bg-gray-700 hover:bg-gray-600 text-white"
          }`}
        >
          <CreditCard size={15} />
          {primaryIsPay ? `Pay ${peso(account.balance)} now` : "Billing page"}
          <ExternalLink size={13} className="opacity-70" />
        </a>
        <a
          href={account.links.payment_settings}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700"
        >
          <Wallet size={15} />
          Payment methods
          <ExternalLink size={13} className="opacity-60" />
        </a>
        <a
          href={account.links.ads_manager}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700"
        >
          Ads Manager
          <ExternalLink size={13} className="opacity-60" />
        </a>
      </div>
    </div>
  );
}

export default function AdsBillingPage() {
  const [data, setData] = useState<BillingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await cachedFetch<BillingResponse>(BILLING_URL, {
        ttl: CLIENT_TTL_MS,
        forceRefresh: force,
      });
      setData(res.data);
      setFetchedAt(res.timestamp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load billing");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A saved limit changes the bar immediately; Meta's figures are untouched.
  const onThresholdSaved = useCallback((accountId: string, setting: ThresholdSetting) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            accounts: prev.accounts.map((a) =>
              a.id === accountId
                ? { ...a, threshold: thresholdStatus(a.balance, setting) }
                : a
            ),
          }
        : prev
    );
  }, []);

  const accounts = data?.accounts ?? [];
  const summary = data?.summary;
  const problem = accounts.filter((a) => a.status.needsPayment);
  const nearLimit = accounts.filter(
    (a) => !a.status.needsPayment && a.threshold.stage !== null
  );
  const otherIssues = accounts.filter(
    (a) => a.status.tone !== "ok" && !a.status.needsPayment
  );

  return (
    <div className="p-6 max-w-7xl mx-auto text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <CreditCard className="text-emerald-400" size={26} />
          <h1 className="text-2xl font-bold">Ads Billing</h1>
        </div>
        <div className="flex items-center gap-3">
          {fetchedAt && (
            <span className="text-xs text-gray-500">
              {data?.stale ? "Stale · " : ""}
              {formatLastRefreshed(fetchedAt)}
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-60"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-400 mb-6 max-w-3xl">
        Every ad account the stores run on, with Meta&apos;s status, the unpaid
        balance and the card on file. When an account stops delivering over a
        failed payment, <span className="text-white">Pay now</span> opens that
        account&apos;s Billing page on Meta with the balance ready to settle —
        Meta does not let the API pay it for you. Each card also tracks the
        balance against the account&apos;s billing limit, and an urgent email
        goes out once the balance reaches the warning level you set.
      </p>

      {/* Rate-limit / stale notice */}
      {data?.rate_limited && (
        <div className="mb-4 rounded-lg border border-yellow-800/60 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-200">
          Facebook is rate-limiting the dashboard, so these figures are from the
          last successful fetch
          {data.blocked_until
            ? ` — try again after ${new Date(data.blocked_until).toLocaleTimeString("en-PH")}`
            : ""}
          .
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-800/60 bg-red-900/20 px-4 py-3 text-sm text-red-200 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            onClick={() => load(true)}
            className="px-3 py-1.5 rounded-md bg-red-800/60 hover:bg-red-700/60 text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Needs-payment banner */}
      {problem.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-700/70 bg-red-950/40 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-100">
                {problem.length === 1
                  ? "1 ad account needs a payment"
                  : `${problem.length} ad accounts need a payment`}
                {" · "}
                <span className="font-bold">{peso(summary?.outstanding ?? 0)}</span> outstanding
              </p>
              <ul className="mt-2 space-y-2">
                {problem.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-red-100/90"
                  >
                    <span className="font-medium text-white">{a.name}</span>
                    {a.stores.length > 0 && (
                      <span className="text-red-200/70">
                        {a.stores.map((s) => s.store).join(", ")}
                      </span>
                    )}
                    <span className="font-semibold">{peso(a.balance)}</span>
                    <a
                      href={a.links.pay}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-500 text-white text-xs font-semibold"
                    >
                      <CreditCard size={12} /> Pay now <ExternalLink size={11} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Near-limit banner: the charge is coming, is the card ready? */}
      {nearLimit.length > 0 && (
        <div
          className={`mb-6 rounded-xl border p-4 ${
            nearLimit.some((a) => a.threshold.stage === "reached")
              ? "border-red-700/70 bg-red-950/40"
              : "border-orange-700/70 bg-orange-950/30"
          }`}
        >
          <div className="flex items-start gap-3">
            <BellRing className="text-orange-300 shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-orange-50">
                {nearLimit.length === 1
                  ? "1 ad account is close to its billing limit"
                  : `${nearLimit.length} ad accounts are close to their billing limit`}
                {" · "}
                <span className="font-normal text-orange-100/80">
                  Meta will charge the card when the balance reaches the limit. If the charge fails, the ads stop.
                </span>
              </p>
              <ul className="mt-2 space-y-2">
                {nearLimit.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-orange-50/90"
                  >
                    <span className="font-medium text-white">{a.name}</span>
                    {a.stores.length > 0 && (
                      <span className="text-orange-200/70">
                        {a.stores.map((s) => s.store).join(", ")}
                      </span>
                    )}
                    <span className="font-semibold">
                      {peso(a.balance)} of {pesoWhole(a.threshold.limit)}
                    </span>
                    <span className="text-xs text-orange-200/70">
                      {a.threshold.stage === "reached"
                        ? "limit reached"
                        : `${pesoWhole(a.threshold.remaining)} to go`}
                    </span>
                    <a
                      href={a.links.pay}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold"
                    >
                      <CreditCard size={12} /> Pay early <ExternalLink size={11} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {otherIssues.length > 0 && problem.length === 0 && (
        <div className="mb-6 rounded-xl border border-orange-800/60 bg-orange-950/30 p-4 text-sm text-orange-100">
          {otherIssues.map((a) => a.name).join(", ")}{" "}
          {otherIssues.length === 1 ? "is" : "are"} not delivering — see the card below for why.
        </div>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          {
            label: "Accounts",
            value: summary ? String(summary.total) : "—",
            tone: "text-white",
          },
          {
            label: "Delivering",
            value: summary ? String(summary.active) : "—",
            tone: "text-green-400",
          },
          {
            label: "Need attention",
            value: summary ? String(summary.needs_attention) : "—",
            tone: summary && summary.needs_attention > 0 ? "text-red-400" : "text-white",
          },
          {
            label: "Outstanding",
            value: summary ? peso(summary.outstanding) : "—",
            tone: summary && summary.outstanding > 0 ? "text-red-300" : "text-white",
          },
        ].map((m) => (
          <div
            key={m.label}
            className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4"
          >
            <span className="text-xs text-gray-400">{m.label}</span>
            {loading ? (
              <div className="h-7 bg-gray-700/50 rounded animate-pulse mt-2" />
            ) : (
              <p className={`text-lg font-bold mt-1 ${m.tone}`}>{m.value}</p>
            )}
          </div>
        ))}
      </div>

      {/* Accounts */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Asking Meta about each account…
        </div>
      ) : accounts.length === 0 && !error ? (
        <div className="text-center py-12 text-gray-500 text-sm">
          No ad accounts to show. Select the accounts to watch in Settings → Facebook Ads.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} onThresholdSaved={onThresholdSaved} />
          ))}
        </div>
      )}

      {data?.refreshed_at && (
        <p className="text-[11px] text-gray-600 mt-6">
          Figures from Meta as of{" "}
          {new Date(data.refreshed_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} PHT.
          Balances are what Meta reports before any pending payment posts.
        </p>
      )}
    </div>
  );
}
