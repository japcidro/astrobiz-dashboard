"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, CheckCircle, AlertCircle, X } from "lucide-react";
import type { CampaignFormData, AdSetFormData, AdFormData } from "@/lib/facebook/types";

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
}

interface BulkSubmissionProgressProps {
  rows: BulkAdRow[];
  adAccountId: string;
  mode: "new" | "existing_campaign";
  existingCampaignId: string | null;
  campaign: CampaignFormData;
  adsetTemplate: AdSetFormData;
  pageId: string;
  pageName: string;
  websiteUrl: string;
  urlParameters: string;
  callToAction: string;
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
  campaign,
  adsetTemplate,
  pageId,
  pageName,
  websiteUrl,
  urlParameters,
  callToAction,
  onUpdateRowStatus,
  onClose,
}: BulkSubmissionProgressProps) {
  const [isRunning, setIsRunning] = useState(false);
  const hasStarted = useRef(false);

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

  const buildAdSetData = (row: BulkAdRow, index: number) => ({
    ...adsetTemplate,
    name: row.adset_name || `${adsetTemplate.name} - Creative ${index + 1}`,
  });

  const submitRows = useCallback(
    async (targetRows: BulkAdRow[]) => {
      setIsRunning(true);
      let fbCampaignId: string | null = existingCampaignId ?? null;

      for (let i = 0; i < targetRows.length; i++) {
        const row = targetRows[i];
        const isFirstEver =
          i === 0 && mode === "new" && fbCampaignId === null;

        onUpdateRowStatus(row.id, "submitting");

        try {
          const payload = {
            draft_id: null,
            ad_account_id: adAccountId,
            mode: isFirstEver ? "new" : "existing_campaign",
            existing_campaign_id: isFirstEver ? null : fbCampaignId,
            existing_adset_id: null,
            campaign_data: isFirstEver ? campaign : null,
            adset_data: buildAdSetData(
              row,
              rows.findIndex((r) => r.id === row.id)
            ),
            ad_data: buildAdData(row),
          };

          const res = await fetch("/api/facebook/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => null);
            throw new Error(
              errBody?.error || errBody?.message || `HTTP ${res.status}`
            );
          }

          const data = await res.json();

          // Capture campaign id from first successful response
          if (!fbCampaignId && data.fb_campaign_id) {
            fbCampaignId = data.fb_campaign_id;
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
      existingCampaignId,
      campaign,
      adsetTemplate,
      pageId,
      pageName,
      websiteUrl,
      urlParameters,
      callToAction,
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

        {/* Row list */}
        <div className="space-y-2 mb-4">
          {rows.map((row) => (
            <div key={row.id}>
              <div className="flex items-center gap-2">
                {row.status === "pending" && (
                  <div className="w-4 h-4 rounded-full border border-gray-500" />
                )}
                {row.status === "uploading" && (
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                )}
                {row.status === "submitting" && (
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
