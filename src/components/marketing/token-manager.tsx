"use client";

import { useState, useTransition } from "react";
import { Key, CheckCircle, AlertTriangle, RefreshCw, Save } from "lucide-react";
import { saveFBSettings, saveSelectedAccounts } from "@/lib/facebook/actions";

interface DetectedAccount {
  id: string;
  name: string;
  account_id: string;
  account_status: number;
  status_label: string;
  is_active: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "text-green-400 bg-green-900/50",
  DISABLED: "text-red-400 bg-red-900/50",
  UNSETTLED: "text-orange-400 bg-orange-900/50",
  PENDING_REVIEW: "text-yellow-400 bg-yellow-900/50",
  PENDING_SETTLEMENT: "text-yellow-400 bg-yellow-900/50",
  GRACE_PERIOD: "text-orange-400 bg-orange-900/50",
  PENDING_CLOSURE: "text-red-400 bg-red-900/50",
  CLOSED: "text-gray-400 bg-gray-700/50",
};

interface TokenManagerProps {
  currentToken: string;
  tokenUpdatedAt: string | null;
  detectedAccounts: DetectedAccount[];
  fetchError: string | null;
  selectedAccountIds: string[];
}

export function TokenManager({
  currentToken,
  tokenUpdatedAt,
  detectedAccounts,
  fetchError,
  selectedAccountIds,
}: TokenManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState(false);
  const [testAccounts, setTestAccounts] = useState<DetectedAccount[] | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedAccountIds));
  const [savingSelection, setSavingSelection] = useState(false);
  const [selectionSaved, setSelectionSaved] = useState(false);

  const handleSave = (formData: FormData) => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      try {
        await saveFBSettings(formData);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
        // Reload to re-fetch accounts server-side
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  };

  const testToken = async () => {
    const input = document.querySelector<HTMLInputElement>('input[name="fb_token"]');
    const token = input?.value;
    if (!token) return;

    setTestLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/facebook/accounts?token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTestAccounts(data.accounts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to test token");
    } finally {
      setTestLoading(false);
    }
  };

  const maskedToken = currentToken
    ? `${currentToken.slice(0, 10)}...${currentToken.slice(-6)}`
    : "Not set";

  const displayAccounts = testAccounts || detectedAccounts;

  const toggleAccount = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectionSaved(false);
  };

  const handleSaveSelection = async () => {
    setSavingSelection(true);
    try {
      await saveSelectedAccounts(Array.from(selected));
      setSelectionSaved(true);
      setTimeout(() => setSelectionSaved(false), 3000);
    } catch {
      setError("Failed to save account selection");
    } finally {
      setSavingSelection(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Token Form */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-blue-600/20 rounded-lg">
            <Key size={20} className="text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Facebook Ads Token</h2>
            <p className="text-sm text-gray-400">
              System User token from Business Manager
            </p>
          </div>
        </div>

        {currentToken && (
          <div className="mb-4 p-3 bg-gray-700/30 rounded-lg">
            <p className="text-xs text-gray-400">Current token</p>
            <p className="text-sm text-white font-mono">{maskedToken}</p>
            {tokenUpdatedAt && (
              <p className="text-xs text-gray-500 mt-1">
                Last updated:{" "}
                {new Date(tokenUpdatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm flex items-center gap-2">
            <CheckCircle size={16} />
            Token saved! Reloading...
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        <form action={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1.5">Access Token</label>
            <input
              type="password"
              name="fb_token"
              placeholder="Paste your Facebook access token"
              defaultValue={currentToken}
              required
              className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <input type="hidden" name="fb_ad_account_id" value="all" />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={testToken}
              disabled={testLoading}
              className="flex-1 flex items-center justify-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={14} className={testLoading ? "animate-spin" : ""} />
              {testLoading ? "Testing..." : "Test Token"}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isPending ? "Saving..." : "Save Token"}
            </button>
          </div>
        </form>
      </div>

      {/* Detected Accounts */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-white">
            Ad Accounts ({displayAccounts.length})
          </h2>
          {displayAccounts.length > 0 && (
            <button
              onClick={handleSaveSelection}
              disabled={savingSelection}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {savingSelection ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : selectionSaved ? (
                <CheckCircle size={14} />
              ) : (
                <Save size={14} />
              )}
              {savingSelection ? "Saving..." : selectionSaved ? "Saved!" : "Save Selection"}
            </button>
          )}
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Check the accounts you want to see in the Ads dashboard.{" "}
          {selected.size > 0 && (
            <span className="text-blue-400">{selected.size} selected</span>
          )}
          {selected.size === 0 && displayAccounts.length > 0 && (
            <span className="text-yellow-400">None selected — all accounts will show</span>
          )}
        </p>

        {displayAccounts.length === 0 && !error && (
          <div className="py-6 text-center text-gray-500 text-sm">
            {currentToken
              ? "No ad accounts found. Check your token permissions."
              : "Save a token first to see ad accounts."}
          </div>
        )}

        {displayAccounts.length > 0 && (
          <div className="space-y-2">
            {displayAccounts.map((acc) => {
              const color = STATUS_COLORS[acc.status_label] || "text-gray-400 bg-gray-700/50";
              const isSelected = selected.has(acc.id);
              return (
                <label
                  key={acc.id}
                  className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-blue-900/30 border border-blue-700/50"
                      : "bg-gray-700/30 border border-transparent hover:bg-gray-700/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleAccount(acc.id)}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                    />
                    <div>
                      <p className="text-sm font-medium text-white">{acc.name}</p>
                      <p className="text-xs text-gray-500 font-mono">{acc.id}</p>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded uppercase ${color}`}
                  >
                    {acc.status_label}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {displayAccounts.length === 1 && (
          <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-700/30 rounded-lg flex items-start gap-2">
            <AlertTriangle size={16} className="text-yellow-400 mt-0.5 shrink-0" />
            <p className="text-xs text-yellow-300/80">
              Only 1 ad account detected. If you have more, make sure your token is from a{" "}
              <strong>System User</strong> with access to all ad accounts. Go to Business
              Settings → System Users → Add Assets → Ad Accounts.
            </p>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <h3 className="text-sm font-medium text-white mb-3">
          How to get a token with all ad accounts:
        </h3>
        <ol className="text-xs text-gray-400 space-y-1.5 list-decimal list-inside">
          <li>Go to Facebook Business Settings → System Users</li>
          <li>Create a System User (or use existing)</li>
          <li>
            Click <strong className="text-white">&quot;Add Assets&quot;</strong> → Select{" "}
            <strong className="text-white">all your Ad Accounts</strong> → Give full control
          </li>
          <li>Click &quot;Generate New Token&quot;</li>
          <li>
            Select permissions:{" "}
            <code className="text-gray-300">ads_read</code>,{" "}
            <code className="text-gray-300">ads_management</code>,{" "}
            <code className="text-gray-300">read_insights</code>
          </li>
          <li>Copy the token and paste it above</li>
        </ol>
        <p className="text-xs text-yellow-400/70 mt-3">
          System User tokens don&apos;t expire. The token can only see ad accounts assigned to the System User.
        </p>
      </div>
    </div>
  );
}
