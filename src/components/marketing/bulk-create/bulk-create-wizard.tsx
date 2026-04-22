"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import type {
  CampaignFormData,
  AdSetFormData,
  CTAType,
} from "@/lib/facebook/types";
import type { ApprovedScript } from "@/lib/ai/approved-scripts-types";
import { StepCampaign } from "@/components/marketing/create/step-campaign";
import { StepAdset } from "@/components/marketing/create/step-adset";
import { PageSelector } from "@/components/marketing/create/page-selector";
import { ScriptPickerModal } from "../script-picker-modal";
import { StoreDefaultsSelector } from "../store-defaults-selector";
import {
  resolveNamePattern,
  type StoreAdDefaults,
} from "@/lib/marketing/store-defaults";
import { AdRowsTable } from "./ad-rows-table";
import { BulkSubmissionProgress } from "./bulk-submission-progress";

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
}

export interface BulkAdRow {
  id: string;
  adset_name: string;
  ad_name: string;
  creative_type: "image" | "video";
  image_hash: string | null;
  video_id: string | null;
  file_name: string | null;
  primary_text: string;
  headline: string;
  description: string;
  status: "pending" | "uploading" | "submitting" | "done" | "error";
  error: string | null;
  // Link back to the approved script that sourced this ad copy. Persisted
  // on the ad_draft row so Phase 2 performance aggregation can trace the
  // ad → fb_ad_id → source_script_id. Nullable: rows can still be written
  // from scratch.
  source_script_id: string | null;
  source_script_title: string | null;
}

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

function makeEmptyRow(): BulkAdRow {
  return {
    id: crypto.randomUUID(),
    adset_name: "",
    ad_name: "",
    creative_type: "image",
    image_hash: null,
    video_id: null,
    file_name: null,
    primary_text: "",
    headline: "",
    description: "",
    status: "pending",
    error: null,
    source_script_id: null,
    source_script_title: null,
  };
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
    <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl">
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
  const [mode, setMode] = useState<"new" | "existing_campaign">("new");
  const [campaign, setCampaign] = useState<CampaignFormData>(defaultCampaign);
  const [existingCampaignId, setExistingCampaignId] = useState<string | null>(
    null
  );
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);

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
  const [creativeType, setCreativeType] = useState<"image" | "video">("image");

  // Section 0: Store (drives per-store autofill; nullable)
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [selectedStoreName, setSelectedStoreName] = useState<string | null>(null);

  // Ad rows
  const [rows, setRows] = useState<BulkAdRow[]>(() => [
    makeEmptyRow(),
    makeEmptyRow(),
    makeEmptyRow(),
  ]);

  // Section D: Submission
  const [submitting, setSubmitting] = useState(false);

  // Script importing (multi-pick from Approved Library)
  const [scriptPickerOpen, setScriptPickerOpen] = useState(false);

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
  useEffect(() => {
    if (!adAccountId || mode !== "existing_campaign") return;
    setLoadingCampaigns(true);
    setCampaigns([]);
    setExistingCampaignId(null);

    import("@/lib/client-cache").then(({ cachedFetch }) =>
    cachedFetch<Record<string, unknown>>(`/api/facebook/all-ads?date_preset=last_30d&account=${adAccountId}`, { ttl: 10 * 60 * 1000 })
      .then(({ data: json }) => {
        if (json.data) {
          const campaignMap = new Map<string, CampaignInfo>();
          for (const row of json.data as Array<Record<string, string>>) {
            if (!campaignMap.has(row.campaign_id)) {
              campaignMap.set(row.campaign_id, {
                id: row.campaign_id,
                name: row.campaign,
                status: row.status,
              });
            }
          }
          setCampaigns(Array.from(campaignMap.values()));
        }
      })
      .finally(() => setLoadingCampaigns(false))
    );
  }, [adAccountId, mode]);

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
  // user clicks "Save current as default". Per-ad fields (row copy, files)
  // are not saved — those are script/creative specific, not store defaults.
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
    };
  }, [
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

  const handleAddRow = useCallback(() => {
    setRows((prev) => [...prev, makeEmptyRow()]);
  }, []);

  const handleRemoveRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // Turns selected approved scripts into pre-filled rows. Hook → headline,
  // body → primary text, angle title → ad name. If the only current rows
  // are untouched empties, replace them; otherwise append.
  const handleImportScripts = useCallback((scripts: ApprovedScript[]) => {
    if (scripts.length === 0) return;
    const newRows: BulkAdRow[] = scripts.map((s) => ({
      ...makeEmptyRow(),
      ad_name: s.angle_title.slice(0, 80),
      primary_text: s.body_script,
      headline: s.hook.slice(0, 255),
      description: "",
      source_script_id: s.id,
      source_script_title: s.angle_title,
    }));
    setRows((prev) => {
      const existingHasContent = prev.some(
        (r) =>
          r.ad_name.trim() ||
          r.primary_text.trim() ||
          r.headline.trim() ||
          r.image_hash ||
          r.video_id
      );
      return existingHasContent ? [...prev, ...newRows] : newRows;
    });
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

  const allRowsHaveAdsetName = rows.length > 0 && rows.every((r) => !!r.adset_name.trim());
  const allRowsHaveAdName = rows.length > 0 && rows.every((r) => !!r.ad_name.trim());
  const allRowsHaveCopy = rows.length > 0 && rows.every((r) =>
    !!r.primary_text.trim() && !!r.headline.trim() && !!r.description.trim()
  );

  // Build missing items list for the submit section
  const missingItems: string[] = [];
  if (!adAccountId) missingItems.push("Select an ad account");
  if (mode === "new" && !campaign.name) missingItems.push("Enter a campaign name");
  if (mode === "existing_campaign" && !existingCampaignId) missingItems.push("Select an existing campaign");
  if (!pageId) missingItems.push("Select a Facebook Page");
  if (!websiteUrl) missingItems.push("Enter a website URL");
  if (rows.length === 0) missingItems.push("Add at least one row");
  if (!allRowsHaveAdsetName) missingItems.push("Enter adset name for every row");
  if (!allRowsHaveAdName) missingItems.push("Enter ad name for every row");
  if (!allRowsHaveCreatives) missingItems.push("Upload creative for every row");
  if (!allRowsHaveCopy) missingItems.push("Enter primary text, headline, and description for every row");
  if (!adset.name?.trim()) missingItems.push("Enter adset name prefix in Section B");

  const canSubmit =
    !!adAccountId &&
    !!pageId &&
    !!websiteUrl &&
    allRowsHaveCreatives &&
    allRowsHaveAdsetName &&
    allRowsHaveAdName &&
    allRowsHaveCopy &&
    (mode === "new" ? !!campaign.name : !!existingCampaignId) &&
    !!adset.name?.trim();

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
      </div>

      <div className="space-y-4">
        {/* ─── Section 0: Store (per-store autofill) ─── */}
        <StoreDefaultsSelector
          selectedStoreId={selectedStoreId}
          onStoreChange={(id, name) => {
            setSelectedStoreId(id);
            setSelectedStoreName(name);
          }}
          onApply={handleApplyStoreDefaults}
          buildSnapshot={buildStoreDefaultsSnapshot}
        />

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
          <div className="mb-6">
            <label className="block text-sm text-gray-400 mb-2">Mode</label>
            <div className="flex gap-3">
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
            </div>
          </div>

          {/* New Campaign form or Existing Campaign dropdown */}
          {mode === "new" ? (
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
              <StepCampaign
                data={campaign}
                onUpdate={(updates) =>
                  setCampaign((prev) => ({ ...prev, ...updates }))
                }
              />
            </div>
          ) : (
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
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
                  onChange={(e) =>
                    setExistingCampaignId(e.target.value || null)
                  }
                  className="w-full max-w-md bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select campaign...</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </Section>

        {/* ─── Section B: Adset Template ─── */}
        <Section title="B. Adset Template">
          <p className="text-gray-500 text-xs mb-4">
            The &quot;Adset Name Prefix&quot; below will be used as the base
            name. Each ad will be created under an adset named
            &quot;[prefix] - Creative N&quot;.
          </p>
          <StepAdset
            data={adset}
            adAccountId={adAccountId}
            pageName={pageName}
            onUpdate={(updates) =>
              setAdset((prev) => ({ ...prev, ...updates }))
            }
          />
        </Section>

        {/* ─── Section C: Shared Ad Settings + Ad Rows ─── */}
        <Section title="C. Ad Creatives">
          {/* Shared fields */}
          <div className="space-y-4 mb-6">
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

            {/* Creative Type Toggle */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Creative Type
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => setCreativeType("image")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                    creativeType === "image"
                      ? "bg-white text-gray-900"
                      : "bg-gray-700 text-gray-400 hover:text-white"
                  }`}
                >
                  Image
                </button>
                <button
                  onClick={() => setCreativeType("video")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                    creativeType === "video"
                      ? "bg-white text-gray-900"
                      : "bg-gray-700 text-gray-400 hover:text-white"
                  }`}
                >
                  Video
                </button>
              </div>
            </div>
          </div>

          {/* Import from Approved Scripts */}
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setScriptPickerOpen(true)}
              className="flex items-center gap-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/50 text-emerald-300 hover:text-emerald-200 text-sm px-4 py-2 rounded-lg transition-colors cursor-pointer"
            >
              <Sparkles size={14} />
              Import from Approved Scripts
            </button>
            <p className="mt-1.5 text-[11px] text-gray-500">
              Pick N scripts from the Approved Library. Each becomes a row with
              hook → headline, body → primary text. Source script is saved so
              performance rolls up in the Library.
            </p>
          </div>

          <ScriptPickerModal
            open={scriptPickerOpen}
            mode="multi"
            onClose={() => setScriptPickerOpen(false)}
            onPickMany={handleImportScripts}
            confirmLabel="Add rows"
            defaultStoreFilter={selectedStoreName}
          />

          {/* Default Copy (fill all rows) */}
          <div className="mb-4 bg-gray-700/20 border border-gray-700/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400">Default ad copy (optional — fills all empty rows)</p>
              <button
                type="button"
                onClick={() => {
                  const defaultText = (document.getElementById("bulk-default-text") as HTMLTextAreaElement)?.value || "";
                  const defaultHeadline = (document.getElementById("bulk-default-headline") as HTMLInputElement)?.value || "";
                  const defaultDesc = (document.getElementById("bulk-default-desc") as HTMLInputElement)?.value || "";
                  setRows((prev) =>
                    prev.map((r) => ({
                      ...r,
                      primary_text: r.primary_text || defaultText,
                      headline: r.headline || defaultHeadline,
                      description: r.description || defaultDesc,
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
                id="bulk-default-text"
                rows={2}
                placeholder="Default primary text..."
                className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
              />
              <input
                id="bulk-default-headline"
                type="text"
                placeholder="Default headline..."
                className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
              <input
                id="bulk-default-desc"
                type="text"
                placeholder="Default description..."
                className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Ad Rows Table */}
          <AdRowsTable
            rows={rows}
            onUpdateRow={handleUpdateRow}
            onAddRow={handleAddRow}
            onRemoveRow={handleRemoveRow}
            adAccountId={adAccountId}
            creativeType={creativeType}
            storeNameFilter={selectedStoreName}
          />
        </Section>

        {/* ─── Section D: Submit ─── */}
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-6 mt-6">
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
              Submit All to Facebook ({rows.length} ads)
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
              <p className="text-green-400 text-xs">Ready to submit {rows.length} ads</p>
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
          campaign={campaign}
          adsetTemplate={adset}
          pageId={pageId}
          pageName={pageName}
          websiteUrl={websiteUrl}
          urlParameters={urlParameters}
          callToAction={callToAction}
          shopifyStoreId={selectedStoreId}
          onClose={() => setSubmitting(false)}
          onUpdateRowStatus={handleUpdateRowStatus}
        />
      )}
    </div>
  );
}
