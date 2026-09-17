/**
 * Shaping for the /api/facebook/all-ads payload.
 *
 * A cached ads entry always holds the superset: every ad, including those
 * with no activity in the selected window (flagged `zero_activity`). Callers
 * that didn't ask for those — the AI agent, the briefings — get them trimmed
 * here instead of from a second cache entry.
 *
 * The two shapes cost identical Facebook calls, so splitting them by cache
 * key bought nothing and cost everything: the warm-cache cron wrote the
 * without-zero-spend key while every dashboard read the with-zero-spend one,
 * so no page view ever hit a warm cache and each one re-walked every ad
 * account until Facebook cut us off with "User request limit reached".
 */

export interface ZeroSpendShapeable {
  data?: Array<{ zero_activity?: boolean }>;
  totals?: Record<string, unknown>;
}

export function shapeForZeroSpend<T extends ZeroSpendShapeable>(
  payload: T,
  includeZeroSpend: boolean
): T {
  if (includeZeroSpend) return payload;

  const rows = payload.data ?? [];
  const spenders = rows.filter((r) => !r.zero_activity);
  if (spenders.length === rows.length) return payload;

  return {
    ...payload,
    data: spenders,
    // `count` is the only total the trimmed rows can change — they carry
    // zero spend, clicks, reach and impressions, so every other aggregate
    // (and the spend-weighted ROAS) is identical either way.
    ...(payload.totals
      ? { totals: { ...payload.totals, count: spenders.length } }
      : {}),
  };
}
