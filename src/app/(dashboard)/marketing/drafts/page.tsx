"use client";

import { useState, useEffect } from "react";
import { FileText, Trash2, Edit, Send, Loader2 } from "lucide-react";
import Link from "next/link";
import type { DraftStatus } from "@/lib/facebook/types";

interface Draft {
  id: string;
  name: string;
  status: DraftStatus;
  mode: string;
  ad_account_id: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_STYLES: Record<DraftStatus, string> = {
  draft: "text-gray-400 bg-gray-700/50",
  submitting: "text-blue-400 bg-blue-900/50",
  submitted: "text-green-400 bg-green-900/50",
  failed: "text-red-400 bg-red-900/50",
};

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchDrafts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/facebook/drafts");
      const json = await res.json();
      if (json.data) setDrafts(json.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this draft?")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/facebook/drafts?id=${id}`, { method: "DELETE" });
      setDrafts((d) => d.filter((draft) => draft.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Ad Drafts</h1>
          <p className="text-gray-400 mt-1 text-sm">
            Saved ad drafts — resume editing or submit to Facebook
          </p>
        </div>
        <Link
          href="/marketing/create"
          className="bg-white text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          + New Ad
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      ) : drafts.length === 0 ? (
        <div className="text-center py-20">
          <FileText size={40} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-500">No drafts yet</p>
          <p className="text-gray-600 text-sm mt-1">
            Create an ad and save it as a draft
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-white font-medium text-sm truncate">
                    {draft.name}
                  </h3>
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase ${STATUS_STYLES[draft.status]}`}
                  >
                    {draft.status}
                  </span>
                </div>
                <p className="text-gray-500 text-xs">
                  Updated {fmtDate(draft.updated_at)}
                  {draft.error_message && (
                    <span className="text-red-400 ml-2">
                      {draft.error_message}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                {(draft.status === "draft" || draft.status === "failed") && (
                  <Link
                    href={`/marketing/create?draft=${draft.id}`}
                    className="text-gray-400 hover:text-white p-1.5 transition-colors"
                    title="Edit & Retry"
                  >
                    <Edit size={16} />
                  </Link>
                )}
                <button
                  onClick={() => handleDelete(draft.id)}
                  disabled={deletingId === draft.id}
                  className="text-gray-400 hover:text-red-400 p-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  title="Delete"
                >
                  {deletingId === draft.id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
