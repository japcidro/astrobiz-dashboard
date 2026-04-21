import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { DatePreset } from "@/lib/facebook/types";
import {
  fetchAdDailyInsights,
  classifyConsistency,
  DEFAULT_WINNER_THRESHOLDS,
  type WinnerThresholds,
} from "@/lib/facebook/insights-daily";
import {
  buildComparativePrompt,
  COMPARE_SYSTEM_PROMPT,
  type StoreDoc,
} from "@/lib/ai/compare-prompt";
import type {
  AdDeconstruction,
  ComparativeAdInput,
  ComparativeReport,
} from "@/lib/ai/compare-types";
import { deriveStore } from "@/lib/shopify/derive-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CLAUDE_MODEL = "claude-opus-4-7";
const MAX_ADS = 10;

function hashAdIds(ids: string[]): string {
  const sorted = [...ids].sort();
  return crypto.createHash("sha256").update(sorted.join(",")).digest("hex");
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  // Claude sometimes wraps JSON in ```json ... ``` despite instructions.
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    ad_ids?: string[];
    date_preset?: DatePreset;
    force_refresh?: boolean;
    thresholds?: Partial<WinnerThresholds>;
  };

  const adIds = Array.isArray(body.ad_ids)
    ? [...new Set(body.ad_ids.filter((id) => typeof id === "string" && id))]
    : [];
  const datePreset: DatePreset = body.date_preset ?? "last_14d";
  const thresholds: WinnerThresholds = {
    ...DEFAULT_WINNER_THRESHOLDS,
    ...(body.thresholds ?? {}),
  };

  if (adIds.length < 2) {
    return Response.json(
      { error: "Pick at least 2 ads to compare." },
      { status: 400 }
    );
  }
  if (adIds.length > MAX_ADS) {
    return Response.json(
      { error: `Max ${MAX_ADS} ads per comparative analysis.` },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const adIdsHash = hashAdIds(adIds);

  // 1. Return cached if fresh (same selection + date_preset within 24h)
  if (!body.force_refresh) {
    const { data: cached } = await supabase
      .from("ad_comparative_analyses")
      .select("*")
      .eq("ad_ids_hash", adIdsHash)
      .eq("date_preset", datePreset)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached) {
      const ageMs = Date.now() - new Date(cached.created_at).getTime();
      if (ageMs < 24 * 60 * 60 * 1000) {
        return Response.json({ cached: true, row: cached });
      }
    }
  }

  // 2. Load deconstructions for every selected ad
  const { data: deconRows, error: deconError } = await supabase
    .from("ad_creative_analyses")
    .select("ad_id, account_id, thumbnail_url, analysis")
    .in("ad_id", adIds);

  if (deconError) {
    return Response.json({ error: deconError.message }, { status: 500 });
  }

  const missingDecon = adIds.filter(
    (id) => !deconRows?.find((r) => r.ad_id === id)
  );
  if (missingDecon.length > 0) {
    return Response.json(
      {
        error:
          "Some ads have not been deconstructed yet. Run Creative Deconstruction on each before comparing.",
        missing_ad_ids: missingDecon,
      },
      { status: 400 }
    );
  }

  // 3. Load FB token
  const { data: tokenRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  const fbToken = (tokenRow?.value as string | undefined) ?? "";
  if (!fbToken) {
    return Response.json(
      { error: "Facebook access token not configured." },
      { status: 400 }
    );
  }

  // 4. Load Shopify store names for deriveStore() — service client because
  //    shopify_stores RLS gates the api_token and the marketing role can't
  //    read it directly. We're only pulling names, not secrets.
  const serviceSupabase = createServiceClient();
  const { data: storeRows } = await serviceSupabase
    .from("shopify_stores")
    .select("name")
    .eq("is_active", true);
  const storeNames = (storeRows ?? [])
    .map((r) => (r.name as string | undefined) ?? "")
    .filter(Boolean);

  // 5. Fetch per-day metrics for each ad in parallel (but capped concurrency)
  //    FB can rate-limit on 10+ parallel insights calls; 4-way parallelism is safe.
  type AdMeta = { ad_id: string; ad_name: string; campaign: string; adset: string; account_id: string; account_name: string; thumbnail_url: string | null; analysis: AdDeconstruction };
  const adMetaByAdId = new Map<string, AdMeta>();
  for (const row of deconRows ?? []) {
    adMetaByAdId.set(row.ad_id as string, {
      ad_id: row.ad_id as string,
      ad_name: "",
      campaign: "",
      adset: "",
      account_id: row.account_id as string,
      account_name: "",
      thumbnail_url: (row.thumbnail_url as string | null) ?? null,
      analysis: row.analysis as AdDeconstruction,
    });
  }

  // Fetch basic ad info (name, campaign, adset) in parallel
  const adInfoResults = await Promise.all(
    adIds.map(async (adId) => {
      try {
        const url = `https://graph.facebook.com/v21.0/${adId}?fields=name,campaign{name},adset{name},account_id&access_token=${encodeURIComponent(fbToken)}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return { ad_id: adId, ok: false as const };
        const json = (await res.json()) as {
          name?: string;
          campaign?: { name?: string };
          adset?: { name?: string };
          account_id?: string;
        };
        return {
          ad_id: adId,
          ok: true as const,
          ad_name: json.name ?? "",
          campaign: json.campaign?.name ?? "",
          adset: json.adset?.name ?? "",
          account_id: json.account_id ?? "",
        };
      } catch {
        return { ad_id: adId, ok: false as const };
      }
    })
  );

  for (const info of adInfoResults) {
    if (!info.ok) continue;
    const meta = adMetaByAdId.get(info.ad_id);
    if (meta) {
      meta.ad_name = info.ad_name;
      meta.campaign = info.campaign;
      meta.adset = info.adset;
      if (info.account_id) meta.account_id = info.account_id;
    }
  }

  // Fetch daily insights with concurrency cap of 4
  const dailyResults: Array<{ ad_id: string; metrics: Awaited<ReturnType<typeof fetchAdDailyInsights>> | null; error?: string }> = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < adIds.length; i += CONCURRENCY) {
    const slice = adIds.slice(i, i + CONCURRENCY);
    const out = await Promise.all(
      slice.map(async (adId) => {
        const meta = adMetaByAdId.get(adId);
        const accountId = meta?.account_id ?? "";
        if (!accountId) {
          return { ad_id: adId, metrics: null, error: "Missing account_id" };
        }
        try {
          const metrics = await fetchAdDailyInsights(
            adId,
            accountId,
            fbToken,
            datePreset
          );
          return { ad_id: adId, metrics };
        } catch (e) {
          return {
            ad_id: adId,
            metrics: null,
            error: e instanceof Error ? e.message : "Unknown insights error",
          };
        }
      })
    );
    dailyResults.push(...out);
  }

  const insightFailures = dailyResults.filter((r) => !r.metrics);
  if (insightFailures.length > 0 && insightFailures.length === adIds.length) {
    return Response.json(
      {
        error: "Failed to fetch daily insights for all selected ads.",
        details: insightFailures.map((f) => `${f.ad_id}: ${f.error}`),
      },
      { status: 502 }
    );
  }

  // 6. Build ComparativeAdInput[]
  const inputs: ComparativeAdInput[] = [];
  for (const result of dailyResults) {
    if (!result.metrics) continue;
    const meta = adMetaByAdId.get(result.ad_id);
    if (!meta) continue;
    const consistency = classifyConsistency(result.metrics, thresholds);
    inputs.push({
      ad_id: meta.ad_id,
      ad_name: meta.ad_name || meta.ad_id,
      campaign: meta.campaign,
      adset: meta.adset,
      account_id: meta.account_id,
      account_name: meta.account_name,
      thumbnail_url: meta.thumbnail_url,
      deconstruction: meta.analysis,
      metrics: result.metrics,
      consistency,
    });
  }

  if (inputs.length < 2) {
    return Response.json(
      { error: "Not enough ads with valid data after fetching metrics." },
      { status: 502 }
    );
  }

  // 7. Detect single store from campaigns
  const detectedStores = new Set<string>();
  for (const ad of inputs) {
    const s = deriveStore(ad.campaign, storeNames);
    if (s) detectedStores.add(s);
  }
  const storeList = [...detectedStores];
  if (storeList.length > 1) {
    return Response.json(
      {
        error:
          "Multiple stores detected in selection. Pick ads from one store per analysis so we can apply that store's brand docs.",
        detected_stores: storeList,
      },
      { status: 400 }
    );
  }
  const storeName = storeList[0] ?? null;

  // 8. Load store knowledge docs
  let storeDocs: StoreDoc[] = [];
  if (storeName) {
    const { data: docs } = await supabase
      .from("ai_store_docs")
      .select("doc_type, title, content")
      .eq("store_name", storeName);
    storeDocs = ((docs ?? []) as StoreDoc[]).filter(
      // Skip the tool-specific system prompts — they're for Angle/Script generator,
      // not comparative analysis. Keep the knowledge docs (Avatar, Market Soph, etc.)
      (d) => !d.doc_type.startsWith("system_")
    );
  }

  // 9. Load Anthropic API key
  const { data: anthropicRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .single();
  const anthropicKey = (anthropicRow?.value as string | undefined) ?? "";
  if (!anthropicKey) {
    return Response.json(
      { error: "Anthropic API key not configured. Go to Settings." },
      { status: 400 }
    );
  }

  // 10. Build prompt + call Claude
  const userPrompt = buildComparativePrompt({
    ads: inputs,
    storeName,
    storeDocs,
    thresholds,
    datePreset,
  });

  let claudeRes: Response;
  try {
    claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        system: COMPARE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
  } catch (e) {
    return Response.json(
      {
        error: `Claude request failed: ${e instanceof Error ? e.message : "unknown"}`,
      },
      { status: 502 }
    );
  }

  if (!claudeRes.ok) {
    const errJson = await claudeRes.json().catch(() => ({}));
    return Response.json(
      {
        error:
          (errJson as { error?: { message?: string } }).error?.message ||
          `Claude API ${claudeRes.status}`,
      },
      { status: claudeRes.status }
    );
  }

  const claudeJson = (await claudeRes.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
    model?: string;
  };

  const rawText =
    claudeJson.content?.find((c) => c.type === "text")?.text ?? "";
  let parsed: ComparativeReport;
  try {
    parsed = JSON.parse(stripJsonFence(rawText)) as ComparativeReport;
  } catch (e) {
    return Response.json(
      {
        error: "Claude returned invalid JSON — retry, or review the prompt.",
        raw: rawText.slice(0, 2000),
        parse_error: e instanceof Error ? e.message : "unknown",
      },
      { status: 502 }
    );
  }

  // 11. Persist + return
  const totalTokens =
    (claudeJson.usage?.input_tokens ?? 0) +
    (claudeJson.usage?.output_tokens ?? 0);
  // Opus 4.7 list pricing: $15 / MTok input, $75 / MTok output (as of session
  // model snapshot). Rough estimate; actual billing authoritative.
  const estCostUsd =
    ((claudeJson.usage?.input_tokens ?? 0) / 1_000_000) * 15 +
    ((claudeJson.usage?.output_tokens ?? 0) / 1_000_000) * 75;

  const accountIds = [
    ...new Set(inputs.map((a) => a.account_id).filter(Boolean)),
  ];

  const inputsSnapshot = {
    date_preset: datePreset,
    thresholds,
    store_docs: storeDocs.map((d) => ({
      doc_type: d.doc_type,
      title: d.title,
    })),
    ads: inputs.map((a) => ({
      ad_id: a.ad_id,
      ad_name: a.ad_name,
      campaign: a.campaign,
      adset: a.adset,
      account_id: a.account_id,
      thumbnail_url: a.thumbnail_url,
      consistency: a.consistency,
      metrics_total: a.metrics.total,
      daily: a.metrics.daily,
    })),
  };

  const { data: inserted, error: insertError } = await supabase
    .from("ad_comparative_analyses")
    .insert({
      ad_ids: adIds,
      ad_ids_hash: adIdsHash,
      account_ids: accountIds,
      store_name: storeName,
      date_preset: datePreset,
      analysis: parsed,
      inputs_snapshot: inputsSnapshot,
      analyzed_by: employee.id,
      model: claudeJson.model ?? CLAUDE_MODEL,
      tokens_used: totalTokens,
      cost_usd: Number.isFinite(estCostUsd) ? estCostUsd : null,
    })
    .select("*")
    .single();

  if (insertError) {
    // Non-fatal — return the result even if caching fails.
    return Response.json({
      cached: false,
      persisted: false,
      persist_error: insertError.message,
      row: {
        analysis: parsed,
        inputs_snapshot: inputsSnapshot,
        ad_ids: adIds,
        ad_ids_hash: adIdsHash,
        account_ids: accountIds,
        store_name: storeName,
        date_preset: datePreset,
        model: claudeJson.model ?? CLAUDE_MODEL,
        created_at: new Date().toISOString(),
      },
    });
  }

  return Response.json({ cached: false, persisted: true, row: inserted });
}
