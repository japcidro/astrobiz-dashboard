import type { SupabaseClient } from "@supabase/supabase-js";

// FB rate-limit handling. Wraps fetch() so every FB Graph call can:
//   1. Detect 429 responses → throw RateLimitedError
//   2. Parse x-business-use-case-usage header → persist worst-case
//      usage % to fb_rate_limit_state so the UI can warn the user
//   3. Be queried ("are we currently rate-limited?") before spending
//      any call budget

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

// Wraps fetch() for FB Graph calls. Throws RateLimitedError on 429 or
// FB error codes in RATE_LIMIT_CODES. Always best-effort records usage
// to fb_rate_limit_state (but never blocks the happy path on the write).
export async function fbFetchWithLimits(
  url: string,
  init: RequestInit,
  supabase: SupabaseClient
): Promise<Response> {
  const res = await fetch(url, init);

  // Usage header comes on every successful response — record best-effort.
  const usageHeader =
    res.headers.get("x-business-use-case-usage") ||
    res.headers.get("x-ad-account-usage");
  if (usageHeader) {
    const { maxUsagePct } = parseUsageHeader(usageHeader);
    if (maxUsagePct !== null) {
      void recordRateLimit(supabase, { usagePct: maxUsagePct });
    }
  }

  if (res.status === 429) {
    const body = await res.clone().json().catch(() => ({}));
    const { message, waitSeconds } = isRateLimitError(body);
    const blockedUntil = waitSeconds
      ? new Date(Date.now() + waitSeconds * 1000)
      : null;
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
      const blockedUntil = waitSeconds
        ? new Date(Date.now() + waitSeconds * 1000)
        : null;
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
