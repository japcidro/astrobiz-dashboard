"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Loader2, AlertCircle, RefreshCw, ExternalLink } from "lucide-react";

interface PolicyEntry {
  scope: string;
  policy: string;
  description: string;
}

interface IssueEntry {
  level: string | null;
  type: string | null;
  summary: string | null;
  message: string | null;
  code: number | null;
}

interface ReviewFeedback {
  ad_id: string;
  effective_status: string | null;
  policies: PolicyEntry[];
  issues: IssueEntry[];
}

interface Props {
  adId: string;
  // Ad name for the header, optional. The API doesn't need it.
  adName?: string | null;
  // The FB ad account id (e.g. "act_123…"). When provided, the
  // "Open in Ads Manager" link drops the user on the exact ad — saves a
  // second of friction when they want to actually edit the creative
  // after reading the reason.
  accountId?: string | null;
  onClose: () => void;
}

// Modal triggered by the "Why?" link next to a DISAPPROVED status
// badge. Fetches FB's ad_review_feedback + issues_info for the ad and
// renders them as a clean list. No FB Ads Manager bounce required.
export function DisapprovalReasonModal({ adId, adName, accountId, onClose }: Props) {
  const [data, setData] = useState<ReviewFeedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/facebook/ad-review-feedback?ad_id=${encodeURIComponent(adId)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load feedback");
      setData(json as ReviewFeedback);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  }, [adId]);

  useEffect(() => {
    run();
  }, [run]);

  const acctNum = accountId ? String(accountId).replace(/^act_/, "") : null;
  const adsManagerHref = acctNum
    ? `https://business.facebook.com/adsmanager/manage/ads?act=${acctNum}&selected_ad_ids=${adId}`
    : null;

  const empty =
    !loading &&
    !error &&
    data &&
    data.policies.length === 0 &&
    data.issues.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-xl shadow-xl my-6 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-700 gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <AlertCircle className="text-red-400 flex-shrink-0" size={18} />
              <h2 className="text-base font-bold text-white truncate">
                Why was this ad disapproved?
              </h2>
            </div>
            <p className="text-xs text-gray-400 mt-1 truncate">
              {adName || adId}
              {data?.effective_status && (
                <span className="ml-2 text-[10px] uppercase text-red-300 bg-red-900/40 border border-red-700/50 rounded px-1.5 py-0.5">
                  {data.effective_status}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 cursor-pointer flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 min-h-[160px] space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-10 text-gray-400 gap-2">
              <Loader2 size={20} className="animate-spin text-red-400" />
              <span className="text-sm">Fetching FB review feedback…</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Failed to fetch</p>
                <p className="text-xs mt-1 break-words">{error}</p>
              </div>
              <button
                onClick={run}
                className="text-xs bg-red-700/30 hover:bg-red-700/50 border border-red-700/50 rounded px-2 py-1 cursor-pointer flex items-center gap-1"
              >
                <RefreshCw size={11} />
                Retry
              </button>
            </div>
          )}

          {empty && (
            <div className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-gray-300">
              <p className="font-medium text-white mb-1">
                FB returned no structured reason.
              </p>
              <p className="text-gray-400 text-xs">
                The ad shows as disapproved but FB didn&apos;t return any
                policy entries or issues_info. This usually means the ad
                was paused or in a deferred-review state. Open it in Ads
                Manager to request review or check the post-level rejection
                notice.
              </p>
            </div>
          )}

          {data && data.policies.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                Policy Violations
              </h3>
              {data.policies.map((p, i) => (
                <div
                  key={`${p.scope}-${p.policy}-${i}`}
                  className="p-3 bg-red-900/15 border border-red-700/40 rounded-lg"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-red-200">
                      {p.policy}
                    </span>
                    <span className="text-[10px] uppercase text-gray-500 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5">
                      {p.scope}
                    </span>
                  </div>
                  <p className="text-xs text-gray-300 mt-2 whitespace-pre-wrap">
                    {p.description}
                  </p>
                </div>
              ))}
            </div>
          )}

          {data && data.issues.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                Issues
              </h3>
              {data.issues.map((it, i) => (
                <div
                  key={i}
                  className="p-3 bg-yellow-900/15 border border-yellow-700/40 rounded-lg"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {it.level && (
                      <span className="text-[10px] uppercase text-yellow-200 bg-yellow-900/40 border border-yellow-700/40 rounded px-1.5 py-0.5">
                        {it.level}
                      </span>
                    )}
                    {it.type && (
                      <span className="text-xs font-medium text-yellow-100">
                        {it.type}
                      </span>
                    )}
                    {it.code != null && (
                      <span className="text-[10px] text-gray-500">
                        code {it.code}
                      </span>
                    )}
                  </div>
                  {it.summary && (
                    <p className="text-xs font-medium text-gray-200 mt-2">
                      {it.summary}
                    </p>
                  )}
                  {it.message && (
                    <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">
                      {it.message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-3 border-t border-gray-700 gap-2 flex-wrap">
          <p className="text-[11px] text-gray-500 truncate">
            Source: FB Graph <code>ad_review_feedback</code> + <code>issues_info</code>
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            {adsManagerHref && (
              <a
                href={adsManagerHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 hover:text-white px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer"
                title="Open this ad in Ads Manager to edit or request review"
              >
                <ExternalLink size={12} />
                Open in Ads Manager
              </a>
            )}
            <button
              onClick={onClose}
              className="text-sm text-gray-300 hover:text-white px-3 py-1.5 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
