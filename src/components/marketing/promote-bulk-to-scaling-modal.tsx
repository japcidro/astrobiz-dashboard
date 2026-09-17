"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  TrendingUp,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Circle,
  XCircle,
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

export interface BulkPromoteSubject {
  ad_id: string;
  ad_name: string;
  // Source adset name — reused as the new scaling adset name when
  // cloning per ad, so scaling traceability mirrors the testing adset.
  adset_name: string;
  // Ad account the source ad lives in. Decides the target store on its
  // own — Meta cannot copy across ad accounts, so the source's account is
  // the only one a copy could land in.
  account_id?: string | null;
  thumbnail_url?: string | null;
  // True when this ad already has a scaling copy. Selecting it is still
  // allowed (e.g. user wants a fresh copy in a different adset) but we
  // surface a warning so they know a duplicate will exist.
  already_scaled?: boolean;
}

interface Props {
  subjects: BulkPromoteSubject[];
  // Parent campaign name for all subjects (adset drill is single-campaign
  // scoped). Used to auto-derive the target store.
  campaign_name: string | null;
  onClose: () => void;
  onComplete: (result: {
    succeeded: number;
    failed: number;
  }) => void;
}

interface Adset {
  id: string;
  name: string;
  effective_status: string;
}

interface StoreConfig {
  store_name: string;
  campaign_id: string;
  campaign_name: string;
  account_id: string;
}

type RowStatus = "idle" | "copying" | "success" | "failed" | "skipped";

interface RowResult {
  status: RowStatus;
  error?: string;
  copied_ad_id?: string | null;
}

// Per-ad destination choice.
//   unset      — user hasn't picked yet (row is ineligible to submit)
//   skip       — explicitly excluded from this bulk run
//   new        — clone the template adset per ad, named after the source adset
//   new-shared — drop the ad into ONE brand-new adset (custom name) that's
//                created once and reused for every "new-shared" row
//   existing   — drop the ad into a specific existing scaling adset
type Destination =
  | { kind: "unset" }
  | { kind: "skip" }
  | { kind: "new" }
  | { kind: "new-shared" }
  | { kind: "existing"; adsetId: string };

function serializeDest(d: Destination): string {
  if (d.kind === "unset") return "";
  if (d.kind === "skip") return "skip";
  if (d.kind === "new") return "new";
  if (d.kind === "new-shared") return "new-shared";
  return `existing:${d.adsetId}`;
}

function parseDest(v: string): Destination {
  if (v === "") return { kind: "unset" };
  if (v === "skip") return { kind: "skip" };
  if (v === "new") return { kind: "new" };
  if (v === "new-shared") return { kind: "new-shared" };
  if (v.startsWith("existing:")) {
    return { kind: "existing", adsetId: v.slice("existing:".length) };
  }
  return { kind: "unset" };
}

// Matches PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED — so the label reflects
// paused state regardless of whether the campaign, adset, or both are
// paused. Other statuses (WITH_ISSUES etc.) render without a tag.
function pausedTag(effective_status: string): string {
  return effective_status.includes("PAUSED") ? " (paused)" : "";
}

export function PromoteBulkToScalingModal({
  subjects,
  campaign_name,
  onClose,
  onComplete,
}: Props) {
  // Ad Performance refreshes in the background, which hands this modal a
  // new `subjects` array for the same ads. Key the derivation off the
  // accounts themselves, and run it once: re-deriving mid-flow would reset
  // the store, and resetting the store clears every per-ad destination the
  // user has already chosen.
  const accountKey = useMemo(
    () => subjects.map((s) => s.account_id ?? "").join(","),
    [subjects]
  );
  // Meta's /copies never leaves an ad account, so the ads themselves name
  // the only account a copy could land in. That, not the store mapping, is
  // what the destination hangs off — a store whose first scaling campaign
  // doesn't exist yet has no mapping to offer, and used to leave this
  // modal with an empty dropdown and no way through it.
  const sourceAccountId = useMemo(
    () => singleAccountId(accountKey.split(",")),
    [accountKey]
  );
  const storeDerived = useRef(false);

  const [configs, setConfigs] = useState<StoreConfig[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [selectedStore, setSelectedStore] = useState<string>("");
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
  const [adsets, setAdsets] = useState<Adset[]>([]);
  const [loadingAdsets, setLoadingAdsets] = useState(false);
  const [templateAdsetId, setTemplateAdsetId] = useState<string>("");
  // Custom name for the single shared new adset. Every row set to
  // "new-shared" lands in one adset created with this name.
  const [sharedNewName, setSharedNewName] = useState<string>("");
  const [destinations, setDestinations] = useState<Map<string, Destination>>(
    new Map()
  );
  const [statusOption, setStatusOption] = useState<"PAUSED" | "ACTIVE">(
    "PAUSED"
  );

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Map<string, RowResult>>(new Map());

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
      if (!storeDerived.current) {
        storeDerived.current = true;
        const derived = resolveStore({
          accountIds: accountKey.split(","),
          campaignName: campaign_name,
          configs: json.rows ?? [],
        });
        if (derived) setSelectedStore(derived);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load config");
    } finally {
      setLoadingConfig(false);
    }
  }, [campaign_name, accountKey]);

  const loadAdsets = useCallback(
    async (args: {
      store: string;
      accountId: string | null;
      campaignId: string;
    }) => {
    setLoadingAdsets(true);
    setAdsets([]);
    setTemplateAdsetId("");
    setSharedNewName("");
    // Store change invalidates every per-row existing-adset choice, so
    // reset the map entirely.
    setDestinations(new Map());
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
      const list = (json.adsets as Adset[]) ?? [];
      setAdsets(list);
      // Auto-pick a sensible source for "New adset" so the user is never
      // forced to hunt for one. Meta can't create a blank adset — it must
      // clone an existing one's targeting/budget — so we default to the
      // first ACTIVE adset (else the first one). The user can still change
      // it, and the new adset starts PAUSED for review either way.
      const def =
        list.find((a) => a.effective_status === "ACTIVE") ?? list[0];
      if (def) setTemplateAdsetId(def.id);
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
  // campaign's instead, which is what the clones will be modelled on. In
  // that case they are templates only, never drop-in destinations.
  const destCampaignId = destinationCampaignId(campaignChoice, configured);
  const adsetCampaignId =
    campaignChoice.kind === "new" ? templateCampaignId : destCampaignId;
  const adsetsAreDestinations = campaignChoice.kind !== "new";

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

  // Changing the destination campaign invalidates every per-row ad set
  // choice — an id from the old campaign is not a destination in the new
  // one. loadAdsets clears the map too, but only when the ad set list
  // itself changes: switching the mapped campaign to "new campaign" keeps
  // the same list (it becomes the template source) while making every
  // "existing ad set" row unsubmittable.
  useEffect(() => {
    setDestinations(new Map());
  }, [campaignChoice]);

  // A store mapped to a different ad account is not a destination — Meta
  // would refuse the copy — so once the ads name their account, only the
  // stores inside it are offered.
  const availableStores = useMemo(() => {
    const rows = sourceAccountId
      ? configs.filter((c) => sameAccount(c.account_id, sourceAccountId))
      : configs;
    return rows.map((c) => c.store_name).sort((a, b) => a.localeCompare(b));
  }, [configs, sourceAccountId]);

  // Enough to go on: either a mapped store, or the ad account the ads came
  // from. Only a selection spanning several ad accounts has neither.
  const destinationReady = !!selectedStore || !!sourceAccountId;

  const getDest = (adId: string): Destination =>
    destinations.get(adId) ?? { kind: "unset" };

  const setRowDest = (adId: string, dest: Destination) => {
    setDestinations((prev) => {
      const next = new Map(prev);
      next.set(adId, dest);
      return next;
    });
  };

  const setAllDest = (dest: Destination) => {
    setDestinations(() => {
      const next = new Map<string, Destination>();
      for (const s of subjects) next.set(s.ad_id, dest);
      return next;
    });
  };

  // Counts of how many rows are set to each destination kind. Used for
  // "Promote N of M" label, for quick-apply UI hints, and for validation.
  const destCounts = useMemo(() => {
    let existing = 0;
    let makeNew = 0;
    let makeNewShared = 0;
    let skip = 0;
    let unset = 0;
    for (const s of subjects) {
      const d = destinations.get(s.ad_id) ?? { kind: "unset" as const };
      if (d.kind === "existing") existing++;
      else if (d.kind === "new") makeNew++;
      else if (d.kind === "new-shared") makeNewShared++;
      else if (d.kind === "skip") skip++;
      else unset++;
    }
    return {
      existing,
      new: makeNew,
      newShared: makeNewShared,
      skip,
      unset,
      active: existing + makeNew + makeNewShared,
    };
  }, [subjects, destinations]);

  const campaignBlocker = campaignBlockReason(campaignChoice, newCampaign);

  const canSubmit = (() => {
    if (submitting || done || loadingAdsets || loadingCampaigns) return false;
    if (!selectedStore && !sourceAccountId) return false;
    if (campaignBlocker) return false;
    if (destCounts.active === 0) return false;
    if (destCounts.new > 0 && !templateAdsetId) return false;
    if (destCounts.newShared > 0 && (!templateAdsetId || sharedNewName.trim().length < 3))
      return false;
    return true;
  })();

  // Plain-language reason the Promote button is disabled, shown in the
  // footer so the blocker is never a mystery (the most common one: every
  // row left on "Skip", or a "New adset" row without a template picked).
  const blockReason = (() => {
    if (submitting || done) return null;
    if (!selectedStore && !sourceAccountId) {
      return "Pick a target store first.";
    }
    if (campaignBlocker) return campaignBlocker;
    if (loadingAdsets) return null;
    if (destCounts.active === 0)
      return "Every ad is set to skip — pick a destination for at least one.";
    if (
      (destCounts.newShared > 0 || destCounts.new > 0) &&
      !templateAdsetId
    )
      return "Pick the ad set new ad sets should copy their targeting & budget from.";
    if (destCounts.newShared > 0 && sharedNewName.trim().length < 3)
      return "Name the shared ad set above (min 3 characters).";
    return null;
  })();

  const tally = useMemo(() => {
    let succeeded = 0;
    let failed = 0;
    for (const r of results.values()) {
      if (r.status === "success") succeeded++;
      else if (r.status === "failed") failed++;
    }
    return { succeeded, failed };
  }, [results]);

  const updateRow = (adId: string, patch: RowResult) => {
    setResults((prev) => {
      const next = new Map(prev);
      next.set(adId, patch);
      return next;
    });
  };

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setResults(new Map());

    // The single shared adset is created lazily on the first "new-shared"
    // row, then its id is reused for every subsequent one so all those ads
    // land in the SAME new adset instead of one adset per ad. A new
    // campaign works the same way: the first row that needs it creates it,
    // everything after targets it by id — otherwise a 12-ad run would end
    // up as 12 identically-named campaigns.
    let sharedAdsetId: string | null = null;
    let createdCampaignId: string | null = null;

    for (let i = 0; i < subjects.length; i++) {
      const subject = subjects[i];
      const dest = getDest(subject.ad_id);
      if (dest.kind === "skip" || dest.kind === "unset") {
        updateRow(subject.ad_id, { status: "skipped" });
        continue;
      }
      updateRow(subject.ad_id, { status: "copying" });
      // Track whether THIS request is the one that creates the shared adset,
      // so we know to capture created_adset_id from the response.
      let creatingShared = false;
      try {
        const payload: Record<string, unknown> = {
          ad_id: subject.ad_id,
          status_option: statusOption,
          // Only when a store maps to this ad account. Without one the
          // destination campaign carries the whole answer.
          ...(selectedStore ? { target_store: selectedStore } : {}),
          ...campaignPayload(campaignChoice, newCampaign, createdCampaignId),
        };
        if (dest.kind === "existing") {
          payload.target_adset_id = dest.adsetId;
        } else if (dest.kind === "new-shared") {
          if (sharedAdsetId) {
            // Adset already created by an earlier row — just drop into it.
            payload.target_adset_id = sharedAdsetId;
          } else {
            // First "new-shared" row: create the adset with the custom name.
            creatingShared = true;
            payload.new_adset = {
              template_adset_id: templateAdsetId,
              name: sharedNewName.trim(),
            };
          }
        } else {
          // Per-ad "new": clone the template, naming the new adset after the
          // source adset so scaling rows mirror testing.
          payload.new_adset = {
            template_adset_id: templateAdsetId,
            name: subject.adset_name.trim() || subject.ad_name.trim(),
          };
        }
        const res = await fetch("/api/marketing/scaling/promote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        // Claim the campaign even from a failure: the route creates it
        // before the ad set clone, and reports its id when that clone is
        // what broke. Without this, every remaining row would create
        // another empty campaign chasing the same error.
        if (json.created_campaign_id) {
          createdCampaignId = json.created_campaign_id as string;
        }
        if (!res.ok) {
          const message = json.error || `Promote failed (${res.status})`;
          updateRow(subject.ad_id, { status: "failed", error: message });
          // Creating the campaign or cloning the ad set is the same work
          // for every ad in the run: if it just failed, it will fail
          // identically for the rest. Stop, say so once, and don't spend
          // another two calls proving it.
          if (json.setup_failed) {
            setError(message);
            for (const later of subjects.slice(i + 1)) {
              updateRow(later.ad_id, { status: "skipped" });
            }
            break;
          }
        } else {
          if (creatingShared && json.created_adset_id) {
            sharedAdsetId = json.created_adset_id as string;
          }
          updateRow(subject.ad_id, {
            status: "success",
            copied_ad_id: json.copied_ad_id ?? null,
          });
        }
      } catch (e) {
        updateRow(subject.ad_id, {
          status: "failed",
          error: e instanceof Error ? e.message : "Promote failed",
        });
      }
    }

    setSubmitting(false);
    setDone(true);
  }

  function handleClose() {
    if (submitting) return;
    if (done) {
      onComplete({
        succeeded: tally.succeeded,
        failed: tally.failed,
      });
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-xl shadow-xl my-6">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-700">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 bg-orange-600/20 rounded-lg flex-shrink-0">
              <TrendingUp size={18} className="text-orange-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white">
                Promote {subjects.length}{" "}
                {subjects.length === 1 ? "ad" : "ads"} to scaling
              </h2>
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                Copies each ad into the campaign you pick. One API call per ad.
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="text-gray-400 hover:text-white p-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Target store — optional. It names a mapped scaling campaign to
              default to; without one the campaign picker below carries the
              whole answer. */}
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
                disabled={submitting || done}
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

          {/* Campaign picker — what the per-ad destinations below are
              relative to, so it has to be settled first. */}
          {destinationReady && (
            <ScalingCampaignPicker
              choice={campaignChoice}
              onChoiceChange={setCampaignChoice}
              draft={newCampaign}
              onDraftChange={setNewCampaign}
              campaigns={campaigns}
              configured={configured}
              loading={loadingCampaigns}
              disabled={submitting || done}
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

          {/* Template adset — cloned for any "New adset" / "New per ad" row */}
          {destinationReady && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                New ad sets copy their targeting &amp; budget from{" "}
                <span className="text-gray-600">
                  (auto-picked — Meta can&apos;t make a blank ad set)
                </span>
              </label>
              {loadingAdsets ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                  <Loader2 size={12} className="animate-spin" />
                  Loading adsets…
                </div>
              ) : adsets.length === 0 ? (
                <div className="text-xs text-yellow-400 p-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                  No adsets in that campaign, so there is nothing to clone.
                  Pick another campaign above, or create an ad set in Ads
                  Manager first — Meta has no way to make a blank one.
                </div>
              ) : (
                <select
                  value={templateAdsetId}
                  onChange={(e) => setTemplateAdsetId(e.target.value)}
                  disabled={submitting || done}
                  className={`w-full bg-gray-800 border text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500 ${
                    !templateAdsetId &&
                    (sharedNewName.trim().length >= 3 ||
                      destCounts.new > 0 ||
                      destCounts.newShared > 0)
                      ? "border-orange-500 ring-1 ring-orange-500/40"
                      : "border-gray-700"
                  }`}
                >
                  <option value="">— Pick a source adset —</option>
                  {adsets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {pausedTag(a.effective_status)}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-[11px] text-gray-500 mt-1">
                Every new ad set below is a copy of this one, made inside the
                target campaign and starting PAUSED. This ad set itself is
                not touched or moved.
              </p>
            </div>
          )}

          {/* New adset name — only used by rows set to "→ New adset". Lets
              the user create ONE custom-named adset and drop the chosen ads
              into it, instead of one auto-named adset per ad. */}
          {destinationReady && adsets.length > 0 && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Name for the shared ad set{" "}
                <span className="text-gray-600">
                  (only used by ads you send to &quot;one shared ad set&quot;)
                </span>
              </label>
              <input
                type="text"
                value={sharedNewName}
                onChange={(e) => setSharedNewName(e.target.value)}
                disabled={submitting || done}
                placeholder="e.g. SCALING — JUNE WINNERS"
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                One ad set with this name is created, and every ad you send
                to it lands inside — so the ads learn together on one budget.
                It starts PAUSED so you can set that budget before it spends;
                the ads themselves follow the &quot;After copy&quot; choice
                at the bottom.
              </p>
            </div>
          )}

          {/* Quick-apply + subjects */}
          <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg overflow-hidden">
            {destinationReady && !submitting && !done && (
              <div className="flex items-center flex-wrap gap-2 px-2 py-1.5 border-b border-gray-700/40 bg-gray-900/30 text-[11px] text-gray-400">
                <span className="text-gray-500">Put every ad:</span>
                <button
                  type="button"
                  onClick={() => setAllDest({ kind: "new-shared" })}
                  title="All three ads learn together in one ad set, on one budget"
                  className="px-2 py-0.5 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500 cursor-pointer"
                >
                  in one shared ad set
                </button>
                <button
                  type="button"
                  onClick={() => setAllDest({ kind: "new" })}
                  title="One ad set each, named after the ad set it came from — kill or scale them individually"
                  className="px-2 py-0.5 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500 cursor-pointer"
                >
                  in its own ad set
                </button>
                {adsetsAreDestinations && (
                  <select
                    value=""
                    disabled={adsets.length === 0}
                    title="Put every ad into one ad set that already exists"
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setAllDest({ kind: "existing", adsetId: v });
                    }}
                    className="bg-gray-800 border border-gray-700 text-gray-300 text-[11px] rounded px-2 py-0.5 max-w-[180px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <option value="">in an ad set that exists…</option>
                    {adsets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {pausedTag(a.effective_status)}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => setAllDest({ kind: "skip" })}
                  className="px-2 py-0.5 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500 cursor-pointer"
                >
                  nowhere (skip all)
                </button>
                <span className="ml-auto text-gray-500">
                  {destCounts.active}/{subjects.length} active
                </span>
              </div>
            )}

            <div className="max-h-64 overflow-y-auto divide-y divide-gray-700/40">
              {subjects.map((s) => {
                const r = results.get(s.ad_id);
                const dest = getDest(s.ad_id);
                const showStatus = submitting || done;
                return (
                  <div
                    key={s.ad_id}
                    className="flex items-center gap-3 p-2"
                  >
                    {s.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.thumbnail_url}
                        alt=""
                        className="w-10 aspect-video object-cover rounded border border-gray-700 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 aspect-video bg-gray-800 rounded border border-gray-700 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white font-medium truncate flex items-center gap-1.5">
                        <span className="truncate">{s.ad_name}</span>
                        {s.already_scaled && (
                          <span
                            className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-300 border border-orange-700/40"
                            title="This ad already has a scaling copy. Promoting again will create a duplicate."
                          >
                            SCALED
                          </span>
                        )}
                      </p>
                      {r?.status === "failed" && r.error ? (
                        // Readable, not hidden behind a hover: a failed
                        // promote is the one row anybody needs to read.
                        <p className="text-[11px] text-red-400 mt-0.5 whitespace-pre-wrap break-words">
                          {r.error}
                        </p>
                      ) : (
                        <p className="text-[11px] text-gray-500 truncate">
                          from {s.adset_name}
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0 w-56 text-right">
                      {showStatus ? (
                        !r || r.status === "idle" ? (
                          <Circle
                            size={14}
                            className="text-gray-600 inline"
                          />
                        ) : r.status === "skipped" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                            Skipped
                          </span>
                        ) : r.status === "copying" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-blue-300">
                            <Loader2 size={12} className="animate-spin" />
                            Copying…
                          </span>
                        ) : r.status === "success" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                            <CheckCircle2 size={12} />
                            Done
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-red-400">
                            <XCircle size={12} />
                            Failed
                          </span>
                        )
                      ) : (
                        <select
                          value={serializeDest(dest)}
                          onChange={(e) =>
                            setRowDest(s.ad_id, parseDest(e.target.value))
                          }
                          disabled={!destinationReady || loadingAdsets}
                          className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-[11px] rounded px-2 py-1 focus:ring-orange-500 focus:border-orange-500 disabled:opacity-50"
                        >
                          <option value="">— Pick destination —</option>
                          {/* Both new-ad-set options stay selectable even
                              when the name or template above is missing:
                              the footer names what is missing, which is
                              more use than an option greyed out for a
                              reason the user has to go hunting for. */}
                          <option value="new-shared">
                            {sharedNewName.trim().length >= 3
                              ? `Into one shared new ad set: "${sharedNewName.trim()}"`
                              : "Into one shared new ad set (name it above)"}
                          </option>
                          <option value="new">
                            {`Into its own new ad set: "${(s.adset_name || s.ad_name).trim()}"`}
                          </option>
                          {adsetsAreDestinations && adsets.length > 0 && (
                            <optgroup label="Into an ad set that already exists">
                              {adsets.map((a) => (
                                <option
                                  key={a.id}
                                  value={`existing:${a.id}`}
                                >
                                  {a.name}
                                  {pausedTag(a.effective_status)}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <option value="skip">
                            Don&apos;t copy this ad
                          </option>
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Status option */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              After copy
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStatusOption("PAUSED")}
                disabled={submitting || done}
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
                disabled={submitting || done}
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

          {/* Result tally */}
          {done && (
            <div className="p-2.5 bg-gray-800/60 border border-gray-700/50 rounded-lg text-xs text-gray-300">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 size={12} />
                  {tally.succeeded} succeeded
                </span>
                {tally.failed > 0 && (
                  <span className="inline-flex items-center gap-1 text-red-400">
                    <XCircle size={12} />
                    {tally.failed} failed
                  </span>
                )}
              </div>
              {tally.failed > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const lines = subjects
                      .map((s) => {
                        const r = results.get(s.ad_id);
                        return r?.status === "failed"
                          ? `${s.ad_name}: ${r.error ?? "unknown error"}`
                          : null;
                      })
                      .filter(Boolean);
                    navigator.clipboard?.writeText(lines.join("\n"));
                  }}
                  className="text-[11px] text-gray-400 underline mt-1 cursor-pointer hover:text-white"
                >
                  Copy the error messages
                </button>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-2.5 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <div>{error}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-700">
          {!done && blockReason && (
            <p className="mr-auto text-[11px] text-orange-300/90 flex items-start gap-1 max-w-[55%]">
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              {blockReason}
            </p>
          )}
          <button
            onClick={handleClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {done ? "Close" : "Cancel"}
          </button>
          {!done && (
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
              {submitting
                ? `Copying ${Math.min(tally.succeeded + tally.failed + 1, destCounts.active)}/${destCounts.active}…`
                : `Promote ${destCounts.active} of ${subjects.length} ${subjects.length === 1 ? "ad" : "ads"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
