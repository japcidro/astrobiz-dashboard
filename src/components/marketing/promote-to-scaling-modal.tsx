"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  TrendingUp,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  CAMPAIGN_OBJECTIVES,
  EMPTY_NEW_CAMPAIGN,
  ScalingCampaignPicker,
  campaignBlockReason,
  campaignPayload,
  defaultObjective,
  destinationCampaignId,
  initialChoice,
  resolveStore,
  sameAccount,
  singleAccountId,
  useScalingCampaigns,
  type CampaignChoice,
  type NewCampaignDraft,
} from "./scaling-campaign-picker";

export interface PromoteSubject {
  ad_id: string;
  ad_name: string;
  // Ad account the source ad lives in. Decides the target store on its
  // own — Meta cannot copy across ad accounts, so the source's account is
  // the only one a copy could land in.
  account_id?: string | null;
  thumbnail_url?: string | null;
  campaign_name?: string | null;
  // Pre-derived store (from campaign name). Caller usually knows this.
  suggested_store?: string | null;
}

interface Props {
  subject: PromoteSubject;
  onClose: () => void;
  onSuccess: (result: {
    copied_ad_id: string | null;
    status: "PAUSED" | "ACTIVE";
    campaign_name: string | null;
  }) => void;
}

interface Adset {
  id: string;
  name: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

interface StoreConfig {
  store_name: string;
  campaign_id: string;
  campaign_name: string;
  account_id: string;
}

export function PromoteToScalingModal({
  subject,
  onClose,
  onSuccess,
}: Props) {
  const [configs, setConfigs] = useState<StoreConfig[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Meta's /copies never leaves an ad account, so the ad itself names the
  // only account its copy could land in. That, not the store mapping, is
  // what the destination hangs off — a store too new to have a scaling
  // campaign has no mapping to offer.
  const sourceAccountId = useMemo(
    () => singleAccountId([subject.account_id]),
    [subject.account_id]
  );

  const [selectedStore, setSelectedStore] = useState<string>(
    subject.suggested_store ?? ""
  );
  const [adsets, setAdsets] = useState<Adset[]>([]);
  const [loadingAdsets, setLoadingAdsets] = useState(false);
  const [selectedAdsetId, setSelectedAdsetId] = useState<string>("");
  const [statusOption, setStatusOption] = useState<"PAUSED" | "ACTIVE">(
    "PAUSED"
  );

  // Destination campaign: the mapped scaling campaign (default), another
  // campaign in the same ad account, or one created on submit.
  const {
    campaigns,
    configured,
    loading: loadingCampaigns,
    error: campaignsError,
  } = useScalingCampaigns(selectedStore, sourceAccountId);
  const [campaignChoice, setCampaignChoice] = useState<CampaignChoice>({
    kind: "unset",
  });
  const [newCampaign, setNewCampaign] =
    useState<NewCampaignDraft>(EMPTY_NEW_CAMPAIGN);
  const [templateCampaignId, setTemplateCampaignId] = useState("");

  // "Existing" = drop ad into a chosen adset.
  // "New"      = clone a template adset, rename it, then drop the ad in.
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [newAdsetName, setNewAdsetName] = useState("");
  const [templateAdsetId, setTemplateAdsetId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fbCode, setFbCode] = useState<number | null>(null);
  const [fbSubcode, setFbSubcode] = useState<number | null>(null);
  const [fbUserMsg, setFbUserMsg] = useState<string | null>(null);
  const [fbTrace, setFbTrace] = useState<string | null>(null);
  const [diag, setDiag] = useState<unknown>(null);
  const [showDiag, setShowDiag] = useState(false);

  const loadConfigs = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch("/api/marketing/scaling/config");
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to load scaling mapping");
      }
      const json = (await res.json()) as { rows: StoreConfig[] };
      setConfigs(json.rows ?? []);

      if (!selectedStore) {
        const store = resolveStore({
          suggested: subject.suggested_store,
          accountIds: [subject.account_id],
          campaignName: subject.campaign_name,
          configs: json.rows ?? [],
        });
        if (store) setSelectedStore(store);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load config");
    } finally {
      setLoadingConfig(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAdsets = useCallback(
    async (args: {
      store: string;
      accountId: string | null;
      campaignId: string;
    }) => {
    setLoadingAdsets(true);
    setAdsets([]);
    setSelectedAdsetId("");
    setTemplateAdsetId("");
    setError(null);
    try {
      // A store resolves its own campaign server-side, so a missing
      // campaign id there just means the campaign list never arrived and
      // the mapped one — the default anyway — stands in. With no store,
      // the ad account plus an explicit campaign carry it instead.
      const query = args.store
        ? `store=${encodeURIComponent(args.store)}`
        : `account_id=${encodeURIComponent(args.accountId ?? "")}`;
      const res = await fetch(
        `/api/marketing/scaling/adsets?${query}` +
          (args.campaignId
            ? `&campaign_id=${encodeURIComponent(args.campaignId)}`
            : "")
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load adsets");
      setAdsets((json.adsets as Adset[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load adsets");
    } finally {
      setLoadingAdsets(false);
    }
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  // A fresh store means a fresh ad account: every campaign-level choice
  // made against the old one is meaningless now.
  useEffect(() => {
    setCampaignChoice(initialChoice(configured));
    setTemplateCampaignId(configured?.id ?? "");
    setNewCampaign((d) => ({ ...d, objective: defaultObjective(configured) }));
  }, [configured]);

  // A campaign that doesn't exist yet has no ad sets — list the template
  // campaign's instead, which is what the clone will be modelled on.
  const adsetCampaignId =
    campaignChoice.kind === "new"
      ? templateCampaignId
      : destinationCampaignId(campaignChoice, configured);

  useEffect(() => {
    const campaignId = adsetCampaignId ?? "";
    // Nothing to list until a campaign is settled — either named here, or
    // supplied by a store's mapping server-side.
    if (!campaignId && !selectedStore) {
      setAdsets([]);
      setTemplateAdsetId("");
      return;
    }
    if (!selectedStore && !sourceAccountId) return;
    loadAdsets({
      store: selectedStore,
      accountId: sourceAccountId,
      campaignId,
    });
  }, [selectedStore, sourceAccountId, adsetCampaignId, loadAdsets]);

  // A cloned ad set has to be legal inside the campaign it lands in, and
  // the objective is what decides that: a purchase-optimised ad set cannot
  // live under an awareness campaign. So a new campaign's objective follows
  // whichever campaign its first ad set is being cloned from — for a store
  // with no scaling campaign mapped, that is the only signal there is.
  useEffect(() => {
    if (campaignChoice.kind !== "new" || !templateCampaignId) return;
    const template = campaigns.find((c) => c.id === templateCampaignId);
    const objective = template?.objective ?? "";
    if (!CAMPAIGN_OBJECTIVES.some((o) => o.value === objective)) return;
    setNewCampaign((d) =>
      d.objective === objective ? d : { ...d, objective }
    );
  }, [campaignChoice.kind, templateCampaignId, campaigns]);

  // Nothing to drop into inside a campaign being created this second.
  useEffect(() => {
    if (campaignChoice.kind === "new") setMode("new");
  }, [campaignChoice.kind]);

  // A store mapped to a different ad account is not a destination — Meta
  // would refuse the copy — so once the ad names its account, only the
  // stores inside it are offered.
  const availableStores = useMemo(() => {
    const rows = sourceAccountId
      ? configs.filter((c) => sameAccount(c.account_id, sourceAccountId))
      : configs;
    return rows.map((c) => c.store_name).sort((a, b) => a.localeCompare(b));
  }, [configs, sourceAccountId]);

  // Enough to go on: either a mapped store, or the ad's own ad account.
  const destinationReady = !!selectedStore || !!sourceAccountId;

  const campaignBlocker = campaignBlockReason(campaignChoice, newCampaign);

  const canSubmit = (() => {
    if (submitting || loadingAdsets || loadingCampaigns) return false;
    if (!selectedStore && !sourceAccountId) return false;
    if (campaignBlocker) return false;
    if (mode === "existing") return !!selectedAdsetId;
    return !!templateAdsetId && newAdsetName.trim().length >= 3;
  })();

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setFbCode(null);
    setFbSubcode(null);
    setFbUserMsg(null);
    setFbTrace(null);
    setDiag(null);
    setShowDiag(false);
    try {
      const payload: Record<string, unknown> = {
        ad_id: subject.ad_id,
        status_option: statusOption,
        // Only when a store maps to this ad account. Without one the
        // destination campaign carries the whole answer.
        ...(selectedStore ? { target_store: selectedStore } : {}),
        ...campaignPayload(campaignChoice, newCampaign),
      };
      if (mode === "existing") {
        payload.target_adset_id = selectedAdsetId;
      } else {
        payload.new_adset = {
          template_adset_id: templateAdsetId,
          name: newAdsetName.trim(),
        };
      }
      const res = await fetch("/api/marketing/scaling/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        if (typeof json.fb_code === "number") setFbCode(json.fb_code);
        if (typeof json.fb_subcode === "number") setFbSubcode(json.fb_subcode);
        if (typeof json.fb_user_msg === "string") setFbUserMsg(json.fb_user_msg);
        if (typeof json.fb_trace === "string") setFbTrace(json.fb_trace);
        if (json.diag) setDiag(json.diag);
        throw new Error(json.error || `Promote failed (${res.status})`);
      }
      onSuccess({
        copied_ad_id: json.copied_ad_id ?? null,
        status: statusOption,
        campaign_name: (json.target_campaign_name as string) ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Promote failed");
    } finally {
      setSubmitting(false);
    }
  }

  const activeAdsetCount = adsets.filter(
    (a) => a.effective_status === "ACTIVE"
  ).length;

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-xl my-6">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-700">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 bg-orange-600/20 rounded-lg flex-shrink-0">
              <TrendingUp size={18} className="text-orange-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white">
                Promote to scaling
              </h2>
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                Duplicates this ad into the campaign and ad set you pick.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-white p-1 cursor-pointer disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Ad preview */}
          <div className="flex items-center gap-3 p-2 bg-gray-800/40 border border-gray-700/50 rounded-lg">
            {subject.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={subject.thumbnail_url}
                alt=""
                className="w-12 aspect-video object-cover rounded border border-gray-700 flex-shrink-0"
              />
            ) : (
              <div className="w-12 aspect-video bg-gray-800 rounded border border-gray-700 flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm text-white font-medium truncate">
                {subject.ad_name}
              </p>
              {subject.campaign_name && (
                <p className="text-xs text-gray-500 truncate">
                  {subject.campaign_name}
                </p>
              )}
            </div>
          </div>

          {/* Store picker — optional. It names a mapped scaling campaign to
              default to; without one the campaign picker carries the whole
              answer. */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              Target store
            </label>
            {loadingConfig ? (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                <Loader2 size={12} className="animate-spin" />
                Loading configured stores…
              </div>
            ) : availableStores.length === 0 ? (
              <div className="text-xs text-gray-400 p-2 bg-gray-800/60 border border-gray-700/50 rounded-lg">
                {sourceAccountId ? (
                  <>
                    No scaling campaign is mapped for this ad account yet —
                    pick a campaign below, or create one. Map it in Admin →
                    Settings → Scaling Campaigns afterwards and the ↑ SCALED
                    badge starts working for this store.
                  </>
                ) : (
                  <>
                    No scaling campaigns mapped. Go to Admin → Settings →
                    Scaling Campaigns to configure first.
                  </>
                )}
              </div>
            ) : (
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                disabled={submitting}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
              >
                <option value="">
                  {sourceAccountId
                    ? "— None — choose a campaign below —"
                    : "— Pick store —"}
                </option>
                {availableStores.map((s) => {
                  const cfg = configs.find((c) => c.store_name === s);
                  return (
                    <option key={s} value={s}>
                      {s} → {cfg?.campaign_name ?? ""}
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* Campaign picker */}
          {destinationReady && (
            <ScalingCampaignPicker
              choice={campaignChoice}
              onChoiceChange={setCampaignChoice}
              draft={newCampaign}
              onDraftChange={setNewCampaign}
              campaigns={campaigns}
              configured={configured}
              loading={loadingCampaigns}
              disabled={submitting}
              storeChosen={destinationReady}
              templateCampaignId={templateCampaignId}
              onTemplateCampaignChange={setTemplateCampaignId}
            />
          )}

          {campaignsError && (
            <div className="text-xs text-yellow-400 p-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
              Could not list this ad account&apos;s campaigns: {campaignsError}
            </div>
          )}

          {/* Mode toggle */}
          {destinationReady && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("existing")}
                disabled={submitting || campaignChoice.kind === "new"}
                title={
                  campaignChoice.kind === "new"
                    ? "A campaign being created has no ad sets yet"
                    : undefined
                }
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  mode === "existing"
                    ? "bg-gray-700 border-gray-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                Into an ad set that exists
              </button>
              <button
                type="button"
                onClick={() => setMode("new")}
                disabled={submitting}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                  mode === "new"
                    ? "bg-gray-700 border-gray-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                Into a new ad set
              </button>
            </div>
          )}

          {/* Existing-adset picker */}
          {destinationReady && mode === "existing" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Target adset{" "}
                {loadingAdsets ? (
                  ""
                ) : (
                  <span className="text-gray-500">
                    ({activeAdsetCount} active of {adsets.length})
                  </span>
                )}
              </label>
              {loadingAdsets ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                  <Loader2 size={12} className="animate-spin" />
                  Loading adsets…
                </div>
              ) : adsets.length === 0 ? (
                <div className="text-xs text-yellow-400 p-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                  No adsets in this campaign. Switch to &quot;+ New adset&quot;
                  to clone one into place.
                </div>
              ) : (
                <select
                  value={selectedAdsetId}
                  onChange={(e) => setSelectedAdsetId(e.target.value)}
                  disabled={submitting}
                  className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
                >
                  <option value="">— Pick adset —</option>
                  {adsets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.effective_status === "PAUSED" ? " (paused)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* New-adset flow */}
          {destinationReady && mode === "new" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Copy its targeting &amp; budget from
                  {campaignChoice.kind === "new" && (
                    <span className="text-gray-600">
                      {" "}
                      — from the campaign chosen above
                    </span>
                  )}
                </label>
                {loadingAdsets ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                    <Loader2 size={12} className="animate-spin" />
                    Loading adsets…
                  </div>
                ) : adsets.length === 0 ? (
                  <div className="text-xs text-yellow-400 p-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                    No adsets in that campaign. Pick another one to clone
                    from, or create an ad set in Ads Manager first — Meta
                    has no way to make a blank one.
                  </div>
                ) : (
                  <select
                    value={templateAdsetId}
                    onChange={(e) => setTemplateAdsetId(e.target.value)}
                    disabled={submitting}
                    className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
                  >
                    <option value="">— Pick template adset —</option>
                    {adsets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.effective_status === "PAUSED" ? " (paused)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Name for the new ad set{" "}
                  <span className="text-gray-500">(min 3 chars)</span>
                </label>
                <input
                  type="text"
                  value={newAdsetName}
                  onChange={(e) => setNewAdsetName(e.target.value)}
                  disabled={submitting}
                  placeholder="e.g. ANGLE 24 — WINNER"
                  className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  The new ad set is a copy of the one above, made inside the
                  target campaign. It starts PAUSED whatever you choose
                  below, so you can set its budget before it spends; the ad
                  itself follows the &quot;After copy&quot; choice.
                </p>
              </div>
            </div>
          )}

          {/* Status option */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              After copy
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStatusOption("PAUSED")}
                disabled={submitting}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                  statusOption === "PAUSED"
                    ? "bg-gray-700 border-gray-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                Keep PAUSED (review first)
              </button>
              <button
                type="button"
                onClick={() => setStatusOption("ACTIVE")}
                disabled={submitting}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                  statusOption === "ACTIVE"
                    ? "bg-emerald-600 border-emerald-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                Activate immediately
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-2.5 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  {error}
                  {fbUserMsg && fbUserMsg !== error && (
                    <div className="text-[11px] text-red-200 mt-1">
                      {fbUserMsg}
                    </div>
                  )}
                  {(fbCode !== null || fbSubcode !== null || fbTrace) && (
                    <div className="text-[11px] text-red-400 mt-1 break-all">
                      {fbCode !== null && <span>FB code: {fbCode}</span>}
                      {fbSubcode !== null && (
                        <span> · subcode: {fbSubcode}</span>
                      )}
                      {fbTrace && <span> · trace: {fbTrace}</span>}
                    </div>
                  )}
                  {diag != null && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setShowDiag((v) => !v)}
                        className="text-[11px] text-red-200 underline cursor-pointer hover:text-white"
                      >
                        {showDiag ? "Hide" : "Show"} diagnostic
                      </button>
                      {showDiag && (
                        <div className="mt-2 space-y-2">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(
                                JSON.stringify(diag, null, 2)
                              );
                            }}
                            className="text-[11px] px-2 py-0.5 bg-red-900/40 border border-red-700/50 rounded hover:bg-red-900/60 cursor-pointer"
                          >
                            Copy JSON
                          </button>
                          <pre className="text-[10px] text-red-200/80 bg-black/40 border border-red-900/40 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                            {JSON.stringify(diag, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-700">
          {campaignBlocker && (
            <p className="mr-auto text-[11px] text-orange-300/90 flex items-start gap-1 max-w-[55%]">
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              {campaignBlocker}
            </p>
          )}
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white rounded-lg cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            {submitting ? "Copying…" : "Promote to scaling"}
          </button>
        </div>
      </div>
    </div>
  );
}
