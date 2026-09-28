import type { SupabaseClient } from "@supabase/supabase-js";

// FB rate-limit handling. Wraps fetch() so every FB Graph call can:
//   1. Detect 429 responses and rate-limit error codes → throw RateLimitedError
//      and record a block window in fb_rate_limit_state
//   2. Parse the usage headers (x-business-use-case-usage, x-ad-account-usage,
//      x-fb-ads-insights-throttle) → persist worst-case usage % so callers can
//      back off before Facebook cuts us off
//   3. Be queried ("are we blocked?", "are we close?") before spending budget
//
// The app is on Marketing API *development access*: per ad account per hour,
// 300 + 40×active ads for ads_management and 600 + 400×active ads for
// insights, and a 300-second block once exceeded. "User request limit
// reached" (code 17) is that block. It carries no "wait N minutes" text, so
// without a default window the block was never recorded and every guard
// stayed inert.

export class RateLimitedError extends Error {
  readonly status: number;
  readonly blockedUntil: Date | null;
  readonly fbCode: number | null;

  constructor(opts: {
    message: string;
    status: number;
    blockedUntil?: Date | null;
    fbCode?: number | null;
  }) {
    super(opts.message);
    this.name = "RateLimitedError";
    this.status = opts.status;
    this.blockedUntil = opts.blockedUntil ?? null;
    this.fbCode = opts.fbCode ?? null;
  }
}

/** Meta blocks a development-tier app for 300 s once it exceeds its quota. */
export const DEFAULT_BLOCK_SECONDS = 300;

/** Above this recorded usage, non-essential work (cache warming) waits. */
export const PRESSURE_THRESHOLD_PCT = 80;

/** A usage reading older than this says nothing about now. */
const PRESSURE_READING_MAX_AGE_MS = 15 * 60 * 1000;

// FB error codes that indicate rate limiting (subset — see
// https://developers.facebook.com/docs/graph-api/overview/rate-limiting)
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);

export function isRateLimitError(body: unknown): {
  limited: boolean;
  code: number | null;
  message: string | null;
  waitSeconds: number | null;
} {
  if (!body || typeof body !== "object") {
    return { limited: false, code: null, message: null, waitSeconds: null };
  }
  const err = (body as { error?: { code?: number; message?: string; error_subcode?: number; error_user_msg?: string } }).error;
  if (!err) return { limited: false, code: null, message: null, waitSeconds: null };

  const code = err.code ?? null;
  const limited = code !== null && RATE_LIMIT_CODES.has(code);
  if (!limited) {
    return { limited: false, code, message: err.message ?? null, waitSeconds: null };
  }

  // FB sometimes embeds "Please wait X minutes" in the message.
  let waitSeconds: number | null = null;
  const msg = err.message || err.error_user_msg || "";
  const match = /(\d+)\s*(minute|minutes|mins?|hour|hours)/i.exec(msg);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    waitSeconds = unit.startsWith("hour") ? n * 3600 : n * 60;
  }

  return { limited: true, code, message: msg, waitSeconds };
}

// Parse x-business-use-case-usage header. FB returns JSON like:
// {"act_123":[{"type":"ads_management","call_count":75,"total_cputime":50,
//              "total_time":60,"estimated_time_to_regain_access":0}]}
// We report the worst call_count across all accounts.
// estimated_time_to_regain_access is in minutes.
export function parseUsageHeader(headerValue: string | null): {
  maxUsagePct: number | null;
  estimatedWaitMinutes: number | null;
} {
  if (!headerValue) return { maxUsagePct: null, estimatedWaitMinutes: null };
  try {
    const parsed = JSON.parse(headerValue) as Record<
      string,
      Array<{
        call_count?: number;
        total_cputime?: number;
        total_time?: number;
        estimated_time_to_regain_access?: number;
      }>
    >;
    let maxPct = 0;
    let maxWait = 0;
    for (const arr of Object.values(parsed)) {
      for (const row of arr || []) {
        const worst = Math.max(
          row.call_count ?? 0,
          row.total_cputime ?? 0,
          row.total_time ?? 0
        );
        if (worst > maxPct) maxPct = worst;
        if ((row.estimated_time_to_regain_access ?? 0) > maxWait) {
          maxWait = row.estimated_time_to_regain_access ?? 0;
        }
      }
    }
    return {
      maxUsagePct: maxPct,
      estimatedWaitMinutes: maxWait > 0 ? maxWait : null,
    };
  } catch {
    return { maxUsagePct: null, estimatedWaitMinutes: null };
  }
}

// Parse x-fb-ads-insights-throttle, sent on /insights calls:
// {"app_id_util_pct":12.5,"acc_id_util_pct":40,"ads_api_access_tier":"development_access"}
export function parseInsightsThrottle(headerValue: string | null): number | null {
  if (!headerValue) return null;
  try {
    const parsed = JSON.parse(headerValue) as { app_id_util_pct?: number; acc_id_util_pct?: number };
    const worst = Math.max(parsed.app_id_util_pct ?? 0, parsed.acc_id_util_pct ?? 0);
    return Number.isFinite(worst) ? worst : null;
  } catch {
    return null;
  }
}

/** Worst usage across every usage header a response carries. */
export function usageFromHeaders(headers: Headers): {
  maxUsagePct: number | null;
  estimatedWaitMinutes: number | null;
} {
  const buc = parseUsageHeader(
    headers.get("x-business-use-case-usage") || headers.get("x-ad-account-usage")
  );
  const insights = parseInsightsThrottle(headers.get("x-fb-ads-insights-throttle"));
  const candidates = [buc.maxUsagePct, insights].filter((n): n is number => n !== null);
  return {
    maxUsagePct: candidates.length > 0 ? Math.max(...candidates) : null,
    estimatedWaitMinutes: buc.estimatedWaitMinutes,
  };
}

/**
 * How long to stay off Facebook after a rate-limit error: the explicit
 * "wait N minutes" if the message had one, else the header's estimate,
 * else Meta's standard 300-second block.
 */
export function blockWindow(
  waitSeconds: number | null,
  estimatedWaitMinutes: number | null,
  now: number = Date.now()
): Date {
  const seconds =
    waitSeconds ??
    (estimatedWaitMinutes ? estimatedWaitMinutes * 60 : null) ??
    DEFAULT_BLOCK_SECONDS;
  return new Date(now + seconds * 1000);
}

export async function recordRateLimit(
  supabase: SupabaseClient,
  opts: {
    usagePct?: number | null;
    blockedUntil?: Date | null;
    message?: string | null;
    is429?: boolean;
  }
): Promise<void> {
  try {
    const patch: Record<string, unknown> = {
      id: 1,
      updated_at: new Date().toISOString(),
    };
    if (opts.usagePct !== undefined && opts.usagePct !== null) {
      patch.usage_pct = opts.usagePct;
    }
    if (opts.blockedUntil !== undefined) {
      patch.blocked_until = opts.blockedUntil
        ? opts.blockedUntil.toISOString()
        : null;
    }
    if (opts.is429) {
      patch.last_429_at = new Date().toISOString();
    }
    if (opts.message !== undefined) {
      patch.last_message = opts.message;
    }
    await supabase
      .from("fb_rate_limit_state")
      .upsert(patch, { onConflict: "id" });
  } catch {
    // Telemetry failure — don't crash the caller
  }
}

// Preflight check: if FB told us we're blocked, refuse to make new calls
// for that window. Returns the blocked-until timestamp (or null if clear).
export async function getBlockedUntil(
  supabase: SupabaseClient
): Promise<Date | null> {
  try {
    const { data } = await supabase
      .from("fb_rate_limit_state")
      .select("blocked_until")
      .eq("id", 1)
      .single();
    if (!data?.blocked_until) return null;
    const until = new Date(data.blocked_until);
    if (until.getTime() < Date.now()) return null;
    return until;
  } catch {
    return null;
  }
}

/**
 * Should non-essential work (cache warming, wide-window refreshes) wait?
 * True while blocked, or when the last usage reading is recent and high.
 * Essential work (a human pressing Refresh, autopilot pausing a losing ad)
 * should check getBlockedUntil only.
 */
export async function isUnderPressure(
  supabase: SupabaseClient,
  thresholdPct: number = PRESSURE_THRESHOLD_PCT
): Promise<{ pressured: boolean; reason: string | null; usagePct: number | null }> {
  try {
    const { data } = await supabase
      .from("fb_rate_limit_state")
      .select("usage_pct, blocked_until, updated_at")
      .eq("id", 1)
      .single();
    if (!data) return { pressured: false, reason: null, usagePct: null };
    if (data.blocked_until && new Date(data.blocked_until).getTime() > Date.now()) {
      return { pressured: true, reason: `blocked until ${data.blocked_until}`, usagePct: Number(data.usage_pct) };
    }
    const pct = data.usage_pct === null ? null : Number(data.usage_pct);
    const fresh = data.updated_at && Date.now() - new Date(data.updated_at).getTime() < PRESSURE_READING_MAX_AGE_MS;
    if (pct !== null && fresh && pct >= thresholdPct) {
      return { pressured: true, reason: `usage at ${pct}%`, usagePct: pct };
    }
    return { pressured: false, reason: null, usagePct: pct };
  } catch {
    return { pressured: false, reason: null, usagePct: null };
  }
}

/**
 * Inspect a Graph API response: record its usage headers, and if it is a
 * rate-limit answer, record the block window and throw RateLimitedError.
 * Any other response (ok or not) is returned untouched for the caller.
 */
export async function inspectFbResponse(
  res: Response,
  supabase: SupabaseClient
): Promise<Response> {
  const usage = usageFromHeaders(res.headers);
  if (usage.maxUsagePct !== null) {
    void recordRateLimit(supabase, { usagePct: usage.maxUsagePct });
  }

  if (res.status === 429) {
    const body = await res.clone().json().catch(() => ({}));
    const { message, waitSeconds } = isRateLimitError(body);
    const blockedUntil = blockWindow(waitSeconds, usage.estimatedWaitMinutes);
    await recordRateLimit(supabase, {
      is429: true,
      blockedUntil,
      message: message ?? "Facebook rate limit (429)",
    });
    throw new RateLimitedError({
      message: message ?? "Facebook rate limit",
      status: 429,
      blockedUntil,
    });
  }

  if (!res.ok) {
    const body = await res.clone().json().catch(() => ({}));
    const { limited, code, message, waitSeconds } = isRateLimitError(body);
    if (limited) {
      const blockedUntil = blockWindow(waitSeconds, usage.estimatedWaitMinutes);
      await recordRateLimit(supabase, {
        is429: true,
        blockedUntil,
        message: message ?? "Facebook rate limit",
      });
      throw new RateLimitedError({
        message: message ?? "Facebook rate limit",
        status: res.status,
        blockedUntil,
        fbCode: code,
      });
    }
  }

  return res;
}

// Wraps fetch() for FB Graph calls. Throws RateLimitedError on 429 or
// FB error codes in RATE_LIMIT_CODES. Always best-effort records usage
// to fb_rate_limit_state (but never blocks the happy path on the write).
export async function fbFetchWithLimits(
  url: string,
  init: RequestInit,
  supabase: SupabaseClient
): Promise<Response> {
  const res = await fetch(url, init);
  return inspectFbResponse(res, supabase);
}
