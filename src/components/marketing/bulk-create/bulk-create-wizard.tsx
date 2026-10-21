"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import type {
  CampaignFormData,
  AdSetFormData,
  CTAType,
} from "@/lib/facebook/types";
import { StepCampaign } from "@/components/marketing/create/step-campaign";
import { StepAdset } from "@/components/marketing/create/step-adset";
import { PageSelector } from "@/components/marketing/create/page-selector";
import { StoreDefaultsSelector } from "../store-defaults-selector";
import { GuideButton } from "@/components/guides/guide-button";
import {
  resolveNamePattern,
  type StoreAdDefaults,
} from "@/lib/marketing/store-defaults";
import { AdRowsTable } from "./ad-rows-table";
import { BulkSubmissionProgress } from "./bulk-submission-progress";
import {
  EMPTY_COPY,
  groupRows,
  makeEmptyRow,
  type BulkAdRow,
  type DefaultCopy,
  type ExistingAdset,
} from "./types";

// ─── Types ───

interface AccountInfo {
  id: string;
  name: string;
  account_id: string;
  status: string;
  is_active: boolean;
}

interface CampaignInfo {
  id: string;
  name: string;
  status: string;
  // Campaign budget (CBO) — its ad sets get no budget of their own.
  uses_campaign_budget?: boolean;
}

type BulkMode = "new" | "existing_campaign" | "existing_adset";

// ─── CTA Options ───

const CTA_OPTIONS: { value: CTAType; label: string }[] = [
  { value: "SHOP_NOW", label: "Shop Now" },
  { value: "LEARN_MORE", label: "Learn More" },
  { value: "ORDER_NOW", label: "Order Now" },
  { value: "GET_OFFER", label: "Get Offer" },
  { value: "SIGN_UP", label: "Sign Up" },
  { value: "BOOK_NOW", label: "Book Now" },
  { value: "CONTACT_US", label: "Contact Us" },
];

// ─── Helpers ───

function getTomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.toISOString().split("T")[0]}T00:00:00+08:00`;
}

// ─── Defaults ───

const defaultCampaign: CampaignFormData = {
  name: "",
  objective: "OUTCOME_SALES",
  special_ad_categories: [],
  campaign_budget_optimization: false,
  daily_budget: null,
  lifetime_budget: null,
  bid_strategy: "LOWEST_COST_WITHOUT_CAP",
};

const defaultAdSet: AdSetFormData = {
  name: "",
  daily_budget: 500,
  lifetime_budget: null,
  start_time: getTomorrowDate(),
  end_time: null,
  optimization_goal: "OFFSITE_CONVERSIONS",
  billing_event: "IMPRESSIONS",
  targeting: {
    geo_locations: { countries: ["PH"] },
    age_min: 18,
    age_max: 65,
    genders: [],
  },
  promoted_object: { pixel_id: "", custom_event_type: "PURCHASE" },
};

// ─── Collapsible Section ───

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-gray-800/30 border border-line rounded-xl">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 cursor-pointer"
      >
        <h2 className="text-white font-semibold">{title}</h2>
        {open ? (
          <ChevronDown size={18} className="text-gray-400" />
        ) : (
          <ChevronRight size={18} className="text-gray-400" />
        )}
      </button>
      {open && <div className="px-6 pb-6">{children}</div>}
    </div>
  );
}

// ─── Main Component ───

export function BulkCreateWizard() {
  // Accounts
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Section A: Setup
  const [adAccountId, setAdAccountId] = useState("");
  const [mode, setMode] = useState<BulkMode>("new");
  const [campaign, setCampaign] = useState<CampaignFormData>(defaultCampaign);
  const [existingCampaignId, setExistingCampaignId] = useState<string | null>(
    null
  );
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [adsets, setAdsets] = useState<ExistingAdset[]>([]);
  const [loadingAdsets, setLoadingAdsets] = useState(false);
  const [adsetsError, setAdsetsError] = useState<string | null>(null);

  // Every ad lands in an ad set the user picks on its row, so the per-row
  // adset name and the Section B template have nothing to do.
  const usingExistingAdset = mode === "existing_adset";

  // Section B: Adset
  const [adset, setAdset] = useState<AdSetFormData>(defaultAdSet);

  // Section C: Shared ad settings
  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [urlParameters, setUrlParameters] = useState(
    "utm_source=facebook&utm_medium=paid"
  );
  const [callToAction, setCallToAction] = useState<CTAType>("SHOP_NOW");
  // "Default ad copy" box — saved with the store defaults.
  const [defaultCopy, setDefaultCopy] = useState<DefaultCopy>(EMPTY_COPY);

  // Section 0: Store (drives per-store autofill; nullable)
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [, setSelectedStoreName] = useState<string | null>(null);

  // Ad rows
  const [rows, setRows] = useState<BulkAdRow[]>(() => [
    makeEmptyRow(),
    makeEmptyRow(),
    makeEmptyRow(),
  ]);

  // Section D: Submission
  const [submitting, setSubmitting] = useState(false);

  // ─── Fetch accounts on mount ───
  useEffect(() => {
    const init = async () => {
      try {
        const { cachedFetch } = await import("@/lib/client-cache");
        const { data: json } = await cachedFetch<Record<string, unknown>>("/api/facebook/accounts", { ttl: 10 * 60 * 1000 });
        if (json.error) {
          setFetchError(json.error as string);
          return;
        }
        if (json.accounts) {
          setAccounts(json.accounts as AccountInfo[]);
          const firstActive = (json.accounts as AccountInfo[]).find(
            (a: AccountInfo) => a.is_active
          );
          if (firstActive) setAdAccountId(firstActive.id);
        }
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // ─── Fetch campaigns when account selected + existing mode ───
  // Read from the campaigns edge, not the ads insights payload: a campaign
  // with no spend in the window is still one you can bulk-add ads to.
  const needsExistingCampaign = mode !== "new";
  useEffect(() => {
    if (!adAccountId || !needsExistingCampaign) return;
    let cancelled = false;
    setLoadingCampaigns(true);
    setCampaigns([]);
    setExistingCampaignId(null);

    import("@/lib/client-cache").then(({ cachedFetch }) =>
      cachedFetch<Record<string, unknown>>(
        `/api/facebook/create/campaigns?account_id=${adAccountId}`,
        { ttl: 5 * 60 * 1000 }
      )
        .then(({ data: json }) => {
          if (cancelled) return;
          setCampaigns((json.data as CampaignInfo[]) ?? []);
        })
        .finally(() => {
          if (!cancelled) setLoadingCampaigns(false);
        })
    );
    return () => {
      cancelled = true;
    };
  }, [adAccountId, needsExistingCampaign]);

  // ─── Fetch ad sets once a campaign is picked in existing-adset mode ───
  // The rows' picks belong to the previous campaign, so they are cleared.
  useEffect(() => {
    setRows((prev) =>
      prev.some((r) => r.existing_adset_id)
        ? prev.map((r) => ({ ...r, existing_adset_id: null }))
        : prev
    );
    if (!existingCampaignId || !usingExistingAdset) return;
    let cancelled = false;
    setLoadingAdsets(true);
    setAdsetsError(null);

    import("@/lib/client-cache").then(({ cachedFetch }) =>
      cachedFetch<Record<string, unknown>>(
        `/api/facebook/create/adsets?campaign_id=${existingCampaignId}`,
        { ttl: 5 * 60 * 1000 }
      )
        .then(({ data: json }) => {
          if (cancelled) return;
          if (json.error) {
            setAdsetsError(json.error as string);
            setAdsets([]);
            return;
          }
          setAdsets((json.data as ExistingAdset[]) ?? []);
        })
        .catch((e: Error) => {
          if (!cancelled) setAdsetsError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoadingAdsets(false);
        })
    );
    return () => {
      cancelled = true;
    };
  }, [existingCampaignId, usingExistingAdset]);

  // ─── Store defaults handlers ───
  //
  // Apply: click-triggered. Patches only the shared/repeatable fields
  // (ad account, page, pixel, URL, CTA, targeting, naming prefix). Leaves
  // already-typed campaign/adset names alone unless they're empty — never
  // silently wipe user work.
  const handleApplyStoreDefaults = useCallback(
    (d: StoreAdDefaults, storeName: string) => {
      if (d.ad_account_id) setAdAccountId(d.ad_account_id);
      if (d.page_id) setPageId(d.page_id);
      if (d.page_name) setPageName(d.page_name);
      if (d.website_url) setWebsiteUrl(d.website_url);
      if (d.url_parameters) setUrlParameters(d.url_parameters);
      if (d.default_cta) setCallToAction(d.default_cta);

      // Saved default copy goes into the box and into any ad whose copy is
      // still empty — same as clicking "Fill Empty Rows".
      const copy: DefaultCopy = {
        primary_text: d.default_primary_text ?? "",
        headline: d.default_headline ?? "",
        description: d.default_description ?? "",
      };
      setDefaultCopy((prev) => ({
        primary_text: copy.primary_text || prev.primary_text,
        headline: copy.headline || prev.headline,
        description: copy.description || prev.description,
      }));
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          primary_text: r.primary_text || copy.primary_text,
          headline: r.headline || copy.headline,
          description: r.description || copy.description,
        }))
      );

      setAdset((prev) => ({
        ...prev,
        daily_budget: d.default_daily_budget ?? prev.daily_budget,
        targeting: {
          ...prev.targeting,
          geo_locations: {
            ...prev.targeting.geo_locations,
            countries:
              d.default_countries && d.default_countries.length > 0
                ? d.default_countries
                : prev.targeting.geo_locations.countries,
          },
          age_min: d.default_age_min ?? prev.targeting.age_min,
          age_max: d.default_age_max ?? prev.targeting.age_max,
        },
        promoted_object: {
          ...prev.promoted_object,
          pixel_id: d.pixel_id ?? prev.promoted_object.pixel_id,
        },
      }));

      // Naming patterns: only fill if currently blank, so we never stomp
      // a half-typed name.
      const nameCtx = { store: storeName, date: new Date().toISOString().split("T")[0] };
      setCampaign((prev) => ({
        ...prev,
        name: prev.name || resolveNamePattern(d.campaign_name_pattern, nameCtx),
      }));
      setAdset((prev) => ({
        ...prev,
        name: prev.name || resolveNamePattern(d.adset_name_pattern, nameCtx),
      }));
      if (d.ad_name_pattern) {
        setRows((prev) =>
          prev.map((r, idx) => ({
            ...r,
            ad_name:
              r.ad_name ||
              resolveNamePattern(d.ad_name_pattern, {
                ...nameCtx,
                script_number: idx + 1,
                creative_type: r.creative_type,
              }),
          }))
        );
      }
    },
    []
  );

  // Snapshot of the current wizard's shared fields, sent to the API when
  // user clicks "Save current as default". The "Default ad copy" box is
  // saved; per-row copy and files are not — those are creative specific.
  const buildStoreDefaultsSnapshot = useCallback(() => {
    return {
      ad_account_id: adAccountId || null,
      page_id: pageId || null,
      page_name: pageName || null,
      pixel_id: adset.promoted_object?.pixel_id || null,
      website_url: websiteUrl || null,
      url_parameters: urlParameters || null,
      default_cta: callToAction,
      default_daily_budget: adset.daily_budget ?? null,
      default_countries: adset.targeting.geo_locations.countries,
      default_age_min: adset.targeting.age_min ?? null,
      default_age_max: adset.targeting.age_max ?? null,
      // Blank copy is left out so it can't wipe copy saved earlier.
      ...(defaultCopy.primary_text.trim() && {
        default_primary_text: defaultCopy.primary_text,
      }),
      ...(defaultCopy.headline.trim() && {
        default_headline: defaultCopy.headline,
      }),
      ...(defaultCopy.description.trim() && {
        default_description: defaultCopy.description,
      }),
    };
  }, [
    defaultCopy,
    adAccountId,
    pageId,
    pageName,
    adset,
    websiteUrl,
    urlParameters,
    callToAction,
  ]);

  // ─── Row handlers ───
  const handleUpdateRow = useCallback(
    (id: string, updates: Partial<BulkAdRow>) => {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
      );
    },
    []
  );

  // A row joining an existing ad set goes right after that ad set's last
  // ad, so an ad set's ads stay together; a new ad set goes at the end.
  const handleAddRows = useCallback((newRows: BulkAdRow[]) => {
    setRows((prev) => {
      const next = [...prev];
      for (const row of newRows) {
        let at = -1;
        next.forEach((r, i) => {
          if (r.group_id === row.group_id) at = i;
        });
        if (at === -1) next.push(row);
        else next.splice(at + 1, 0, row);
      }
      return next;
    });
  }, []);

  const handleUpdateGroup = useCallback(
    (
      groupId: string,
      updates: Partial<
        Pick<BulkAdRow, "adset_name" | "adset_budget" | "existing_adset_id">
      >
    ) => {
      setRows((prev) =>
        prev.map((r) => (r.group_id === groupId ? { ...r, ...updates } : r))
      );
    },
    []
  );

  const handleRemoveRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleUpdateRowStatus = useCallback(
    (
      id: string,
      status: BulkAdRow["status"],
      error: string | null = null
    ) => {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status, error } : r))
      );
    },
    []
  );

  // ─── Validation ───
  const allRowsHaveCreatives = rows.length > 0 && rows.every((r) => !!r.image_hash || !!r.video_id);

  const allRowsHaveAdsetName =
    usingExistingAdset ||
    (rows.length > 0 && rows.every((r) => !!r.adset_name.trim()));
  const allRowsHaveAdName = rows.length > 0 && rows.every((r) => !!r.ad_name.trim());
  const allRowsHaveCopy = rows.length > 0 && rows.every((r) =>
    !!r.primary_text.trim() && !!r.headline.trim() && !!r.description.trim()
  );

  // Under a campaign budget (CBO) the ad sets carry none — new campaign with
  // CBO switched on, or an existing campaign that has its own budget.
  const campaignBudget =
    mode === "new"
      ? campaign.campaign_budget_optimization
      : !!campaigns.find((c) => c.id === existingCampaignId)?.uses_campaign_budget;
  const sectionBBudget = adset.daily_budget ?? adset.lifetime_budget ?? null;
  // Per-ad-set budget column: only when we create ad sets and they own the
  // budget — then it is the only budget input (Section B shows a note). A
  // blank cell uses the default amount (500, or the store's saved default).
  const budgetColumn =
    usingExistingAdset || campaignBudget
      ? null
      : {
          kind: adset.lifetime_budget != null ? ("lifetime" as const) : ("daily" as const),
          fallback: sectionBBudget,
        };
  const groups = groupRows(rows);
  // Existing-ad-set mode: each group has picked an ad set of this campaign.
  const existingAdsetIds = new Set(
    groups.map((g) => g.rows[0].existing_adset_id).filter(Boolean)
  );
  const allGroupsHaveExistingAdset =
    !usingExistingAdset ||
    groups.every((g) => !!g.rows[0].existing_adset_id);
  const allAdsetsHaveBudget =
    !budgetColumn ||
    sectionBBudget != null ||
    groups.every((g) => g.rows[0].adset_budget != null);

  // Facebook needs an end date on any ad set with a lifetime budget.
  const hasEndDateIfLifetime =
    budgetColumn?.kind !== "lifetime" || !!adset.end_time;

  const adsetCount = usingExistingAdset ? existingAdsetIds.size : groups.length;
  const adsLabel = `${rows.length} ${rows.length === 1 ? "ad" : "ads"}`;
  const submitLabel = usingExistingAdset
    ? `${adsLabel} → ${adsetCount} existing ${adsetCount === 1 ? "ad set" : "ad sets"}`
    : `${adsLabel}, ${adsetCount} ${adsetCount === 1 ? "ad set" : "ad sets"}`;

  // Build missing items list for the submit section
  const missingItems: string[] = [];
  if (!adAccountId) missingItems.push("Select an ad account");
  if (mode === "new" && !campaign.name) missingItems.push("Enter a campaign name");
  if (mode !== "new" && !existingCampaignId) missingItems.push("Select an existing campaign");
  if (!allGroupsHaveExistingAdset) missingItems.push("Pick an existing ad set for every row");
  if (!pageId) missingItems.push("Select a Facebook Page");
  if (!websiteUrl) missingItems.push("Enter a website URL");
  if (rows.length === 0) missingItems.push("Add at least one row");
  if (!allRowsHaveAdsetName) missingItems.push("Enter adset name for every row");
  if (!allAdsetsHaveBudget)
    missingItems.push("Set a budget for every ad set");
  if (!hasEndDateIfLifetime)
    missingItems.push("Set an end date in Section B — a lifetime budget needs one");
  if (!allRowsHaveAdName) missingItems.push("Enter ad name for every row");
  if (!allRowsHaveCreatives) missingItems.push("Upload creative for every row");
  if (!allRowsHaveCopy) missingItems.push("Enter primary text, headline, and description for every row");

  const canSubmit =
    !!adAccountId &&
    !!pageId &&
    !!websiteUrl &&
    allRowsHaveCreatives &&
    allRowsHaveAdsetName &&
    allAdsetsHaveBudget &&
    hasEndDateIfLifetime &&
    allRowsHaveAdName &&
    allRowsHaveCopy &&
    (mode === "new" ? !!campaign.name : !!existingCampaignId) &&
    allGroupsHaveExistingAdset;

  // ─── Loading / Error ───
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-6 text-center">
        <p className="text-red-300 font-medium mb-1">Failed to load accounts</p>
        <p className="text-red-400 text-sm">{fetchError}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/marketing/ads"
          className="text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold text-white">Bulk Create Ads</h1>
        <GuideButton guide="bulk-create" />
      </div>

      <div className="space-y-4">
        {/* ─── Section 0: Store (per-store autofill) ─── */}
        <div data-guide="bulk-create.store">
          <StoreDefaultsSelector
            selectedStoreId={selectedStoreId}
            onStoreChange={(id, name) => {
              setSelectedStoreId(id);
              setSelectedStoreName(name);
            }}
            onApply={handleApplyStoreDefaults}
            buildSnapshot={buildStoreDefaultsSnapshot}
          />
        </div>

        {/* ─── Section A: Setup ─── */}
        <Section title="A. Setup">
          {/* Ad Account */}
          <div className="mb-6">
            <label className="block text-sm text-gray-400 mb-1.5">
              Ad Account
            </label>
            <select
              value={adAccountId}
              onChange={(e) => {
                setAdAccountId(e.target.value);
                setExistingCampaignId(null);
              }}
              className="w-full max-w-md bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.is_active}>
                  {a.name}
                  {!a.is_active ? ` (${a.status})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Mode Toggle */}
          <div className="mb-6" data-guide="bulk-create.mode">
            <label className="block text-sm text-gray-400 mb-2">Mode</label>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setMode("new")}
                className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                  mode === "new"
                    ? "bg-white text-gray-900"
                    : "bg-gray-700 text-gray-400 hover:text-white"
                }`}
              >
                New Campaign
              </button>
              <button
                onClick={() => setMode("existing_campaign")}
                className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                  mode === "existing_campaign"
                    ? "bg-white text-gray-900"
                    : "bg-gray-700 text-gray-400 hover:text-white"
                }`}
              >
                Existing Campaign
              </button>
              <button
                onClick={() => setMode("existing_adset")}
                className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                  mode === "existing_adset"
                    ? "bg-white text-gray-900"
                    : "bg-gray-700 text-gray-400 hover:text-white"
                }`}
              >
                Existing Ad Set
              </button>
            </div>
            <p className="text-gray-500 text-xs mt-2">
              {mode === "new"
                ? "One new campaign, one new ad set per row. \"+ Ad\" on a row adds another ad to that row's ad set."
                : mode === "existing_campaign"
                ? "New ad sets under a campaign you already run. \"+ Ad\" on a row adds another ad to that row's ad set."
                : "Every ad goes into an ad set you already run — pick the ad set on each row below. \"+ Ad\" adds another ad to that row's ad set. No new ad sets are created."}
            </p>
          </div>

          {/* New Campaign form or Existing Campaign dropdown */}
          {mode === "new" ? (
            <div className="bg-panel rounded-xl p-4 border border-line">
              <StepCampaign
                data={campaign}
                onUpdate={(updates) =>
                  setCampaign((prev) => ({ ...prev, ...updates }))
                }
              />
            </div>
          ) : (
            <div className="bg-panel rounded-xl p-4 border border-line">
              <label className="block text-sm text-gray-400 mb-1.5">
                Select Campaign
              </label>
              {loadingCampaigns ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                  <Loader2 size={14} className="animate-spin" />
                  Loading campaigns...
                </div>
              ) : (
                <select
                  value={existingCampaignId || ""}
                  onChange={(e) => setExistingCampaignId(e.target.value || null)}
                  className="w-full max-w-md bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select campaign...</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.uses_campaign_budget ? " — CBO" : ""}
                    </option>
                  ))}
                </select>
              )}

              {usingExistingAdset && (
                <p className="text-gray-500 text-xs mt-3">
                  Pick the ad set for each row in the table below — the
                  dropdown lists this campaign&apos;s ad sets.
                </p>
              )}
            </div>
          )}
        </Section>

        {/* ─── Section B: Adset Template ─── */}
        <div data-guide="bulk-create.adset">
        {usingExistingAdset ? (
          <div className="bg-gray-800/30 border border-line rounded-xl px-6 py-4">
            <h2 className="text-white font-semibold">B. Adset Template</h2>
            <p className="text-gray-500 text-xs mt-1">
              Not needed — the ads are going into ad sets that already
              exist, with their own budget, schedule and targeting.
            </p>
          </div>
        ) : (
        <Section title="B. Adset Template">
          <p className="text-gray-500 text-xs mb-4">
            Budget, schedule and targeting below apply to every ad set created
            from the table in Section C.
          </p>
          <StepAdset
            data={adset}
            adAccountId={adAccountId}
            pageName={pageName}
            campaignBudget={campaignBudget}
            // Every row names its own ad set, so the template's name is unused.
            hideName
            budgetNote={
              budgetColumn
                ? "Set per ad set in the Budget column of the table in Section C."
                : undefined
            }
            onUpdate={(updates) =>
              setAdset((prev) => ({ ...prev, ...updates }))
            }
          />
        </Section>
        )}
        </div>

        {/* ─── Section C: Shared Ad Settings + Ad Rows ─── */}
        <Section title="C. Ad Creatives">
          {/* Shared fields */}
          <div className="space-y-4 mb-6" data-guide="bulk-create.shared">
            {/* Page Selector */}
            <div className="max-w-lg">
              <PageSelector
                selectedPageId={pageId}
                onChange={(id, name) => {
                  setPageId(id);
                  setPageName(name);
                }}
              />
            </div>

            {/* Website URL */}
            <div className="max-w-lg">
              <label className="block text-sm text-gray-400 mb-1.5">
                Website URL
              </label>
              <input
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://yourstore.com/sale"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* URL Parameters */}
            <div className="max-w-lg">
              <label className="block text-sm text-gray-400 mb-1.5">
                URL Parameters{" "}
                <span className="text-gray-600">(for tracking)</span>
              </label>
              <input
                type="text"
                value={urlParameters}
                onChange={(e) => setUrlParameters(e.target.value)}
                placeholder="utm_source=facebook&utm_medium=paid"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* CTA */}
            <div className="max-w-lg">
              <label className="block text-sm text-gray-400 mb-2">
                Call to Action
              </label>
              <div className="flex flex-wrap gap-2">
                {CTA_OPTIONS.map((cta) => (
                  <button
                    key={cta.value}
                    onClick={() => setCallToAction(cta.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                      callToAction === cta.value
                        ? "bg-white text-gray-900"
                        : "bg-gray-700 text-gray-400 hover:text-white"
                    }`}
                  >
                    {cta.label}
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* Default Copy (fill all rows) */}
          <div className="mb-4 bg-gray-700/20 border border-line rounded-lg p-4" data-guide="bulk-create.copy">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400">Default ad copy (optional — fills all empty rows)</p>
              <button
                type="button"
                onClick={() => {
                  setRows((prev) =>
                    prev.map((r) => ({
                      ...r,
                      primary_text: r.primary_text || defaultCopy.primary_text,
                      headline: r.headline || defaultCopy.headline,
                      description: r.description || defaultCopy.description,
                    }))
                  );
                }}
                className="text-xs bg-gray-600 hover:bg-gray-500 text-white px-3 py-1 rounded transition-colors cursor-pointer"
              >
                Fill Empty Rows
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <textarea
                rows={2}
                value={defaultCopy.primary_text}
                onChange={(e) =>
                  setDefaultCopy((prev) => ({ ...prev, primary_text: e.target.value }))
                }
                placeholder="Default primary text..."
                className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
              />
              <input
                type="text"
                value={defaultCopy.headline}
                onChange={(e) =>
                  setDefaultCopy((prev) => ({ ...prev, headline: e.target.value }))
                }
                placeholder="Default headline..."
                className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
              <input
                type="text"
                value={defaultCopy.description}
                onChange={(e) =>
                  setDefaultCopy((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Default description..."
                className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Ad Rows Table */}
          <AdRowsTable
            rows={rows}
            existingAdsets={
              usingExistingAdset
                ? { adsets, loading: loadingAdsets, error: adsetsError }
                : null
            }
            onUpdateRow={handleUpdateRow}
            budget={budgetColumn}
            onBudgetKindChange={(kind) =>
              setAdset((prev) =>
                kind === "daily"
                  ? { ...prev, daily_budget: prev.daily_budget ?? 500, lifetime_budget: null }
                  : { ...prev, lifetime_budget: prev.lifetime_budget ?? 5000, daily_budget: null }
              )
            }
            onUpdateGroup={handleUpdateGroup}
            onAddRows={handleAddRows}
            onRemoveRow={handleRemoveRow}
            adAccountId={adAccountId}
            shopifyStoreId={selectedStoreId}
          />
        </Section>

        {/* ─── Section D: Submit ─── */}
        <div className="bg-gray-800/30 border border-line rounded-xl p-6 mt-6" data-guide="bulk-create.submit">
          <div className="flex items-center gap-4">
            <button
              disabled={!canSubmit}
              onClick={() => setSubmitting(true)}
              className={`px-6 py-3 rounded-lg text-sm font-semibold transition-colors ${
                canSubmit
                  ? "bg-white text-gray-900 hover:bg-gray-200 cursor-pointer"
                  : "bg-gray-700 text-gray-500 cursor-not-allowed"
              }`}
            >
              Submit All to Facebook ({submitLabel})
            </button>
            {!canSubmit && (
              <div className="text-xs space-y-0.5">
                {missingItems.length > 0 ? (
                  missingItems.map((item) => (
                    <p key={item} className="text-red-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                      {item}
                    </p>
                  ))
                ) : (
                  <p className="text-yellow-400">Checking requirements...</p>
                )}
              </div>
            )}
            {canSubmit && (
              <p className="text-green-400 text-xs">Ready to submit {submitLabel}</p>
            )}
          </div>
        </div>
      </div>

      {/* Submission overlay */}
      {submitting && (
        <BulkSubmissionProgress
          rows={rows}
          adAccountId={adAccountId}
          mode={mode}
          existingCampaignId={existingCampaignId}
          existingAdsets={adsets}
          campaign={campaign}
          adsetTemplate={adset}
          pageId={pageId}
          pageName={pageName}
          websiteUrl={websiteUrl}
          urlParameters={urlParameters}
          callToAction={callToAction}
          shopifyStoreId={selectedStoreId}
          campaignBudget={campaignBudget}
          onClose={() => setSubmitting(false)}
          onUpdateRowStatus={handleUpdateRowStatus}
        />
      )}
    </div>
  );
}
