"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, CheckCircle, AlertCircle, X } from "lucide-react";
import type { CampaignFormData, AdSetFormData, AdFormData } from "@/lib/facebook/types";
import { groupRows, type BulkAdRow } from "./types";

interface BulkSubmissionProgressProps {
  rows: BulkAdRow[];
  adAccountId: string;
  mode: "new" | "existing_campaign" | "existing_adset";
  existingCampaignId: string | null;
  existingAdsetId: string | null;
  campaign: CampaignFormData;
  adsetTemplate: AdSetFormData;
  pageId: string;
  pageName: string;
  websiteUrl: string;
  urlParameters: string;
  callToAction: string;
  shopifyStoreId: string | null;
  onUpdateRowStatus: (
    id: string,
    status: BulkAdRow["status"],
    error?: string | null
  ) => void;
  onClose: () => void;
}

export function BulkSubmissionProgress({
  rows,
  adAccountId,
  mode,
  existingCampaignId,
  existingAdsetId,
  campaign,
  adsetTemplate,
  pageId,
  pageName,
  websiteUrl,
  urlParameters,
  callToAction,
  shopifyStoreId,
  onUpdateRowStatus,
  onClose,
}: BulkSubmissionProgressProps) {
  const [isRunning, setIsRunning] = useState(false);
  const hasStarted = useRef(false);
  const usingExistingAdset = mode === "existing_adset";

  // What Facebook has already created, kept across "Retry Failed" so a retry
  // adds to the same campaign and ad sets instead of making new ones.
  // A stale existing-campaign pick must not leak into "new" mode.
  const campaignIdRef = useRef<string | null>(
    mode === "new" ? null : existingCampaignId
  );
  const adsetIdsRef = useRef(new Map<string, string>());

  const groups = groupRows(rows);

  const buildAdData = (row: BulkAdRow): AdFormData => ({
    name: row.ad_name,
    page_id: pageId,
    page_name: pageName,
    creative_type: row.creative_type,
    image_hash: row.image_hash,
    video_id: row.video_id,
    file_name: row.file_name,
    file_preview_url: null,
    primary_text: row.primary_text,
    headline: row.headline,
    description: row.description,
    call_to_action: callToAction,
    website_url: websiteUrl,
    url_parameters: urlParameters,
  } as AdFormData);

  // A blank ad set name falls back to "<prefix> - <ad set number>".
  const buildAdSetData = (row: BulkAdRow) => {
    const number = groups.findIndex((g) => g.group_id === row.group_id) + 1;
    return {
      ...adsetTemplate,
      name: row.adset_name.trim() || `${adsetTemplate.name} - ${number}`,
    };
  };

  const submitRows = useCallback(
    async (targetRows: BulkAdRow[]) => {
      setIsRunning(true);

      for (const row of targetRows) {
        onUpdateRowStatus(row.id, "submitting");

        // The first ad of a group creates its ad set; the rest join it.
        const adsetId = usingExistingAdset
          ? existingAdsetId
          : adsetIdsRef.current.get(row.group_id) ?? null;
        const createCampaign = mode === "new" && !campaignIdRef.current;
        const effectiveMode = adsetId
          ? "existing_adset"
          : createCampaign
          ? "new"
          : "existing_campaign";
        const effectiveCampaignId = createCampaign ? null : campaignIdRef.current;
        const effectiveCampaignData = createCampaign ? campaign : null;
        // An existing ad set brings its own budget, schedule and targeting —
        // sending a template would only invite Facebook to reject it.
        const rowAdsetData = adsetId ? null : buildAdSetData(row);
        const rowAdData = buildAdData(row);

        try {
          // If a store is selected, create an ad_draft first so the
          // shopify_store_id is persisted against the fb_ad_id that the
          // create endpoint later stamps.
          let draftId: string | null = null;
          if (shopifyStoreId) {
            const draftRes = await fetch("/api/facebook/drafts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ad_account_id: adAccountId,
                name: row.ad_name || row.adset_name || "Bulk Ad",
                mode: effectiveMode,
                existing_campaign_id: effectiveCampaignId,
                existing_adset_id: adsetId,
                campaign_data: effectiveCampaignData,
                adset_data: rowAdsetData,
                ad_data: rowAdData,
                shopify_store_id: shopifyStoreId,
              }),
            });
            const draftJson = await draftRes.json();
            if (!draftRes.ok) {
              throw new Error(
                draftJson?.error ||
                  `Failed to create draft for script-linked row (HTTP ${draftRes.status})`
              );
            }
            draftId = draftJson?.data?.id ?? null;
          }

          const payload = {
            draft_id: draftId,
            ad_account_id: adAccountId,
            mode: effectiveMode,
            existing_campaign_id: effectiveCampaignId,
            existing_adset_id: adsetId,
            campaign_data: effectiveCampaignData,
            adset_data: rowAdsetData,
            ad_data: rowAdData,
          };

          const res = await fetch("/api/facebook/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => null);

          // Remember what got created even when the ad itself failed, so the
          // next ad in this group (or a retry) doesn't duplicate it.
          if (!campaignIdRef.current && data?.fb_campaign_id) {
            campaignIdRef.current = data.fb_campaign_id;
          }
          if (!usingExistingAdset && data?.fb_adset_id) {
            adsetIdsRef.current.set(row.group_id, data.fb_adset_id);
          }

          if (!res.ok) {
            throw new Error(
              data?.error || data?.message || `HTTP ${res.status}`
            );
          }

          onUpdateRowStatus(row.id, "done");
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Unknown error";
          onUpdateRowStatus(row.id, "error", message);
        }
      }

      setIsRunning(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      adAccountId,
      mode,
      existingAdsetId,
      campaign,
      adsetTemplate,
      pageId,
      pageName,
      websiteUrl,
      urlParameters,
      callToAction,
      shopifyStoreId,
    ]
  );

  // Run on mount
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    submitRows(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetryFailed = () => {
    const failedRows = rows.filter((r) => r.status === "error");
    if (failedRows.length === 0) return;
    hasStarted.current = true;
    submitRows(failedRows);
  };

  const doneCount = rows.filter((r) => r.status === "done").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const completedCount = doneCount + errorCount;
  const allDone = !isRunning && completedCount === rows.length;
  const progressPct =
    rows.length > 0 ? Math.round((completedCount / rows.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            {allDone ? "Submission Complete" : "Submitting Ads..."}
          </h2>
          {allDone && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-sm text-gray-400 mb-4">
          {completedCount} / {rows.length} processed
        </p>

        {/* Ads, grouped by ad set */}
        <div className="space-y-3 mb-4">
          {groups.map((group, gi) => (
            <div key={group.group_id}>
              {!usingExistingAdset && (
                <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                  {group.adset_name.trim() || `${adsetTemplate.name} - ${gi + 1}`}
                </p>
              )}
              <div className="space-y-1.5">
                {group.rows.map((row) => (
                  <div key={row.id}>
                    <div className="flex items-center gap-2">
                      {row.status === "pending" && (
                        <div className="w-4 h-4 rounded-full border border-gray-500" />
                      )}
                      {(row.status === "uploading" ||
                        row.status === "submitting") && (
                        <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                      )}
                      {row.status === "done" && (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      )}
                      {row.status === "error" && (
                        <AlertCircle className="w-4 h-4 text-red-400" />
                      )}
                      <span
                        className={`text-sm ${
                          row.status === "error"
                            ? "text-red-300"
                            : row.status === "done"
                            ? "text-green-300"
                            : "text-gray-300"
                        }`}
                      >
                        {row.ad_name}
                      </span>
                    </div>
                    {row.status === "error" && row.error && (
                      <p className="text-xs text-red-400 ml-6 mt-0.5">
                        {row.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Summary + actions */}
        {allDone && (
          <div className="border-t border-gray-700 pt-4 space-y-3">
            <p className="text-sm text-gray-300">
              {doneCount} of {rows.length} ads created successfully.
            </p>
            <div className="flex gap-2">
              {errorCount > 0 && (
                <button
                  onClick={handleRetryFailed}
                  className="px-4 py-2 text-sm bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg"
                >
                  Retry Failed
                </button>
              )}
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
