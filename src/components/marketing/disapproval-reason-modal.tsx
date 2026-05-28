"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Sparkles,
  Wand2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  // AI-inference state — fires only when user clicks the button.
  const [aiMarkdown, setAiMarkdown] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNoTranscript, setAiNoTranscript] = useState(false);
  // Transcribe (Gemini) state — fires when user hits 'Deconstruct now'
  // from inside this modal because no transcript existed yet.
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

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

  // AI-inference call. Sends the captured transcript + Meta's policy
  // categories to Claude and gets a line-by-line breakdown of which
  // claims likely triggered the rejection plus compliant rewrites.
  const runAiAnalysis = useCallback(async () => {
    if (aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    setAiNoTranscript(false);
    try {
      const res = await fetch("/api/marketing/ad-rejection-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_id: adId,
          policies: data?.policies ?? [],
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.no_transcript) {
          setAiNoTranscript(true);
        } else {
          throw new Error(json.error || "AI analysis failed");
        }
        return;
      }
      setAiMarkdown((json as { markdown?: string }).markdown ?? null);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI analysis failed");
    } finally {
      setAiLoading(false);
    }
  }, [adId, data, aiLoading]);

  // One-click 'Deconstruct now' inside this modal: trigger Gemini to
  // transcribe the ad video, then auto-fire the AI rejection analysis
  // against the fresh transcript. Saves the marketer from bouncing to
  // the Creatives page and back.
  const transcribeAndAnalyze = useCallback(async () => {
    if (transcribing) return;
    setTranscribing(true);
    setTranscribeError(null);
    setAiError(null);
    setAiNoTranscript(false);
    try {
      const res = await fetch("/api/marketing/deconstructor/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_id: adId, account_id: accountId }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Transcribe failed");
      }
      // Transcript now lives in ad_creative_analyses. Fire the AI
      // rejection analysis against it immediately.
      await runAiAnalysis();
    } catch (e) {
      setTranscribeError(
        e instanceof Error ? e.message : "Transcribe failed"
      );
    } finally {
      setTranscribing(false);
    }
  }, [adId, accountId, runAiAnalysis, transcribing]);

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

          {/* AI-inference section — fires only on user click. Meta only
              exposes the policy CATEGORY (e.g. "Health and Wellness");
              this runs Claude against the captured transcript to infer
              which specific lines triggered the rejection + how to
              rewrite them compliantly. */}
          {data && !loading && !error && (
            <div className="mt-2 pt-3 border-t border-gray-700/50 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                  Specific Reasons (AI Inference)
                </h3>
                <span className="text-[10px] text-yellow-300/80 bg-yellow-900/20 border border-yellow-700/40 rounded px-1.5 py-0.5">
                  AI INFERENCE · NOT META OFFICIAL
                </span>
              </div>

              {!aiMarkdown && !aiLoading && !aiError && !aiNoTranscript && (
                <div className="p-3 bg-purple-900/15 border border-purple-700/40 rounded-lg">
                  <p className="text-xs text-gray-300 mb-2">
                    Meta only returns the policy category. Run Claude
                    against this ad&apos;s transcript to pinpoint{" "}
                    <span className="text-white font-medium">
                      which specific lines
                    </span>{" "}
                    most likely triggered the rejection — and get
                    compliant rewrites for each.
                  </p>
                  <button
                    onClick={runAiAnalysis}
                    disabled={aiLoading}
                    className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer"
                    title="Run Claude Sonnet 4.6 against the captured transcript + Meta's policy categories. Takes 10–25s."
                  >
                    <Sparkles size={12} />
                    Get specific reason (AI)
                  </button>
                </div>
              )}

              {aiLoading && (
                <div className="flex items-center gap-2 text-gray-400 py-4">
                  <Loader2 size={16} className="animate-spin text-purple-400" />
                  <span className="text-xs">
                    Claude is reading the transcript + Meta&apos;s policy
                    rules…
                  </span>
                </div>
              )}

              {aiNoTranscript && !transcribing && (
                <div className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-300">
                  <p className="font-medium text-white mb-1">
                    No transcript captured for this ad yet.
                  </p>
                  <p className="text-gray-400 mb-3">
                    The AI analysis needs the ad&apos;s text. Click below
                    to transcribe the video now (~30–90s), then the
                    rejection analysis fires automatically.
                  </p>
                  <button
                    onClick={transcribeAndAnalyze}
                    disabled={transcribing}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-wait text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer"
                    title="Transcribe with Gemini, then auto-run the AI rejection analysis"
                  >
                    <Wand2 size={12} />
                    Deconstruct now
                  </button>
                  {transcribeError && (
                    <div className="mt-3 p-2 bg-red-900/30 border border-red-700/50 rounded text-red-300 text-xs">
                      <p className="font-medium">Deconstruct failed</p>
                      <p className="mt-1 break-words">{transcribeError}</p>
                    </div>
                  )}
                </div>
              )}

              {transcribing && (
                <div className="flex items-start gap-2 text-gray-400 py-3 px-3 bg-emerald-900/10 border border-emerald-700/30 rounded-lg">
                  <Loader2 size={16} className="animate-spin text-emerald-400 mt-0.5 flex-shrink-0" />
                  <div className="text-xs">
                    <p className="text-white font-medium">
                      Transcribing video with Gemini…
                    </p>
                    <p className="text-gray-400 mt-0.5">
                      Downloading the FB video and running Gemini Vision
                      (30–90s). AI rejection analysis fires right after.
                    </p>
                  </div>
                </div>
              )}

              {aiError && (
                <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">AI analysis failed</p>
                    <p className="mt-1 break-words">{aiError}</p>
                  </div>
                  <button
                    onClick={runAiAnalysis}
                    className="text-xs bg-red-700/30 hover:bg-red-700/50 border border-red-700/50 rounded px-2 py-1 cursor-pointer flex items-center gap-1"
                  >
                    <RefreshCw size={11} />
                    Retry
                  </button>
                </div>
              )}

              {aiMarkdown && (
                <div className="p-4 bg-purple-900/10 border border-purple-700/40 rounded-lg">
                  <div className="text-sm text-gray-200 leading-relaxed">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => (
                          <p className="mb-2 last:mb-0">{children}</p>
                        ),
                        h1: ({ children }) => (
                          <h3 className="text-sm font-bold text-white mt-3 mb-1 first:mt-0">
                            {children}
                          </h3>
                        ),
                        h2: ({ children }) => (
                          <h3 className="text-sm font-bold text-purple-200 mt-3 mb-1 first:mt-0">
                            {children}
                          </h3>
                        ),
                        h3: ({ children }) => (
                          <h4 className="text-xs font-semibold text-white mt-2 mb-1">
                            {children}
                          </h4>
                        ),
                        ul: ({ children }) => (
                          <ul className="list-disc pl-5 mb-2 space-y-0.5">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal pl-5 mb-2 space-y-0.5">
                            {children}
                          </ol>
                        ),
                        strong: ({ children }) => (
                          <strong className="text-white font-semibold">
                            {children}
                          </strong>
                        ),
                        em: ({ children }) => (
                          <em className="text-purple-200 not-italic font-medium">
                            {children}
                          </em>
                        ),
                        code: ({ children }) => (
                          <code className="bg-gray-900/70 px-1.5 py-0.5 rounded text-emerald-300 text-[12px] font-mono">
                            {children}
                          </code>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-2 border-purple-500/60 pl-3 my-2 text-gray-300 italic">
                            {children}
                          </blockquote>
                        ),
                      }}
                    >
                      {aiMarkdown}
                    </ReactMarkdown>
                  </div>
                  <div className="mt-3 pt-3 border-t border-purple-700/30 flex items-center justify-between gap-2">
                    <p className="text-[10px] text-gray-500">
                      Claude Sonnet 4.6 inference · Meta only confirmed the
                      category, not the line
                    </p>
                    <button
                      onClick={runAiAnalysis}
                      disabled={aiLoading}
                      className="text-[11px] text-gray-400 hover:text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Re-run AI analysis"
                    >
                      <RefreshCw size={10} />
                      Re-run
                    </button>
                  </div>
                </div>
              )}
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
