"use client";

import { useState, useEffect, useCallback } from "react";
import { Save, Volume2, Loader2, CheckCircle2 } from "lucide-react";
import type {
  CallConfirmerConfig,
  CallConfirmerLanguage,
  ShopifyStoreLite,
} from "@/lib/call-confirmer/types";
import { DEFAULT_GREETING_TEMPLATE } from "@/lib/call-confirmer/types";
import { StoreSelector } from "./store-selector";
import { VoicePicker } from "./voice-picker";

interface Props {
  stores: ShopifyStoreLite[];
  configs: CallConfirmerConfig[];
  onConfigsChange: (configs: CallConfirmerConfig[]) => void;
  selectedStoreId: string;
  onStoreChange: (id: string) => void;
}

interface FormState {
  enabled: boolean;
  agent_name: string;
  voice_id: string | null;
  language: CallConfirmerLanguage;
  greeting_template: string;
  business_hours_start: string;
  business_hours_end: string;
  max_attempts: number;
  retry_interval_minutes: number;
  support_phone: string;
  daily_budget_usd: number;
  per_call_max_seconds: number;
}

const DEFAULT_FORM: FormState = {
  enabled: false,
  agent_name: "Maria",
  voice_id: null,
  language: "taglish",
  greeting_template: DEFAULT_GREETING_TEMPLATE,
  business_hours_start: "09:00",
  business_hours_end: "18:00",
  max_attempts: 3,
  retry_interval_minutes: 90,
  support_phone: "",
  daily_budget_usd: 5.0,
  per_call_max_seconds: 120,
};

function configToForm(config: CallConfirmerConfig | undefined): FormState {
  if (!config) return DEFAULT_FORM;
  return {
    enabled: config.enabled,
    agent_name: config.agent_name,
    voice_id: config.voice_id,
    language: config.language,
    greeting_template: config.greeting_template ?? DEFAULT_GREETING_TEMPLATE,
    business_hours_start: config.business_hours_start.slice(0, 5),
    business_hours_end: config.business_hours_end.slice(0, 5),
    max_attempts: config.max_attempts,
    retry_interval_minutes: config.retry_interval_minutes,
    support_phone: config.support_phone ?? "",
    daily_budget_usd: Number(config.daily_budget_usd),
    per_call_max_seconds: config.per_call_max_seconds,
  };
}

export function SettingsTab({
  stores,
  configs,
  onConfigsChange,
  selectedStoreId,
  onStoreChange,
}: Props) {
  const currentConfig = configs.find((c) => c.store_id === selectedStoreId);
  const [form, setForm] = useState<FormState>(configToForm(currentConfig));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setForm(configToForm(currentConfig));
    setDirty(false);
    setError(null);
    setSavedAt(null);
  }, [selectedStoreId, currentConfig]);

  const update = useCallback(<K extends keyof FormState>(
    key: K,
    value: FormState[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSavedAt(null);
  }, []);

  const validate = (): string | null => {
    if (form.enabled) {
      if (!form.voice_id) return "Pick a voice before enabling.";
      if (!form.support_phone || !/^\+\d{10,15}$/.test(form.support_phone)) {
        return "Support phone must be in E.164 format (e.g. +639171234567).";
      }
    }
    if (form.daily_budget_usd <= 0) return "Daily budget must be > 0.";
    if (form.per_call_max_seconds < 30 || form.per_call_max_seconds > 300) {
      return "Per-call max seconds must be between 30 and 300.";
    }
    if (form.max_attempts < 1 || form.max_attempts > 10) {
      return "Max attempts must be between 1 and 10.";
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/call-confirmer/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: selectedStoreId,
          ...form,
          support_phone: form.support_phone || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");

      const updated: CallConfirmerConfig = data.config;
      const newConfigs = configs.some((c) => c.store_id === selectedStoreId)
        ? configs.map((c) =>
            c.store_id === selectedStoreId ? updated : c
          )
        : [...configs, updated];
      onConfigsChange(newConfigs);
      setDirty(false);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt((v) => (v === Date.now() ? null : v)), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <StoreSelector
          stores={stores}
          value={selectedStoreId}
          onChange={onStoreChange}
        />
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={14} /> Saved
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm px-4 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Enable toggle card */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-white font-medium">Enable Call Confirmer</h3>
            <p className="text-sm text-gray-500 mt-1">
              When off, no calls (real or test) can be initiated for this
              store.
            </p>
          </div>
          <Toggle
            value={form.enabled}
            onChange={(v) => update("enabled", v)}
          />
        </div>
      </Card>

      {/* Persona */}
      <Card title="Agent Persona">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Agent Name">
            <input
              type="text"
              value={form.agent_name}
              onChange={(e) => update("agent_name", e.target.value)}
              className={inputCls}
              placeholder="Maria"
            />
          </Field>
          <Field label="Language">
            <select
              value={form.language}
              onChange={(e) =>
                update("language", e.target.value as CallConfirmerLanguage)
              }
              className={inputCls}
            >
              <option value="taglish">Taglish (70% English, 30% Tagalog)</option>
              <option value="tagalog">Pure Tagalog</option>
              <option value="english">English</option>
            </select>
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Voice">
            <VoicePicker
              value={form.voice_id}
              agentName={form.agent_name || "Maria"}
              storeName={
                stores.find((s) => s.id === selectedStoreId)?.name ?? "Astrobiz"
              }
              onChange={(id) => update("voice_id", id)}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label="Greeting Template"
            hint="Variables: {customer_name}, {agent_name}, {store_name}, {order_name}"
          >
            <textarea
              value={form.greeting_template}
              onChange={(e) => update("greeting_template", e.target.value)}
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </Field>
        </div>
      </Card>

      {/* Operating window */}
      <Card title="Operating Window (PH local time)">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Start">
            <input
              type="time"
              value={form.business_hours_start}
              onChange={(e) =>
                update("business_hours_start", e.target.value)
              }
              className={inputCls}
            />
          </Field>
          <Field label="End">
            <input
              type="time"
              value={form.business_hours_end}
              onChange={(e) =>
                update("business_hours_end", e.target.value)
              }
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      {/* Retry */}
      <Card title="Retry Behavior">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Max Attempts">
            <input
              type="number"
              min={1}
              max={10}
              value={form.max_attempts}
              onChange={(e) =>
                update("max_attempts", parseInt(e.target.value, 10) || 1)
              }
              className={inputCls}
            />
          </Field>
          <Field label="Retry Interval (minutes)">
            <input
              type="number"
              min={5}
              max={1440}
              value={form.retry_interval_minutes}
              onChange={(e) =>
                update(
                  "retry_interval_minutes",
                  parseInt(e.target.value, 10) || 60
                )
              }
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      {/* Handoff */}
      <Card title="Human Handoff">
        <Field
          label="Support Phone (E.164)"
          hint="VAs will call this when AI marks an order as needing human follow-up."
        >
          <input
            type="tel"
            value={form.support_phone}
            onChange={(e) => update("support_phone", e.target.value)}
            className={inputCls}
            placeholder="+639171234567"
          />
        </Field>
      </Card>

      {/* Cost guardrails */}
      <Card title="Cost Guardrails">
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 mb-4">
          <p className="text-xs text-amber-300/90 flex items-start gap-2">
            <Volume2 size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              <strong>Daily cap is the hard ceiling.</strong> Once reached today,
              no more calls (test or real) can be initiated until tomorrow.
              Each call costs ~$0.20–0.35.
            </span>
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Daily Budget (USD)">
            <input
              type="number"
              step={0.5}
              min={0.5}
              max={1000}
              value={form.daily_budget_usd}
              onChange={(e) =>
                update("daily_budget_usd", parseFloat(e.target.value) || 5)
              }
              className={inputCls}
            />
          </Field>
          <Field label="Per-Call Max Seconds">
            <input
              type="number"
              min={30}
              max={300}
              value={form.per_call_max_seconds}
              onChange={(e) =>
                update(
                  "per_call_max_seconds",
                  parseInt(e.target.value, 10) || 120
                )
              }
              className={inputCls}
            />
          </Field>
        </div>
      </Card>
    </div>
  );
}

const inputCls =
  "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500";

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
      {title && <h3 className="text-white font-medium mb-4">{title}</h3>}
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-300 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
        value ? "bg-emerald-600" : "bg-gray-700"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
          value ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
