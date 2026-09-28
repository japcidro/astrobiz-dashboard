/**
 * Billing threshold — when Meta charges the card, and how close an
 * account is to that charge.
 *
 * Meta bills a postpaid ad account every time its unpaid balance reaches
 * the account's payment threshold (₱50,000 on our accounts): the card is
 * charged for the balance, and the balance starts again from zero. The
 * Graph API does not expose that threshold (`adspaymentcycle` and
 * `billing_threshold` both come back as nonexistent fields), so the
 * dashboard keeps the limit per account in `app_settings`
 * (`fb_billing_thresholds`) and compares the live `balance` against it.
 *
 * The point of watching it: the charge fails when the card cannot cover
 * the limit, and a failed charge stops every ad in the account. An alert
 * before the limit gives time to fund the card or pay the balance early.
 */

export const BILLING_THRESHOLDS_KEY = "fb_billing_thresholds";

export const DEFAULT_BILLING_LIMIT = 50_000;
/** Alert when the balance reaches this share of the limit (₱40,000 of ₱50,000). */
export const DEFAULT_ALERT_FRACTION = 0.8;

export interface ThresholdSetting {
  /** Meta's payment threshold for the account, in ₱. */
  limit: number;
  /** Balance at which to send the warning, in ₱. */
  alert_at: number;
}

/** Shape stored under `fb_billing_thresholds` in app_settings. */
export interface ThresholdConfig {
  default: ThresholdSetting;
  accounts: Record<string, Partial<ThresholdSetting>>;
}

export const DEFAULT_THRESHOLD_CONFIG: ThresholdConfig = {
  default: {
    limit: DEFAULT_BILLING_LIMIT,
    alert_at: Math.round(DEFAULT_BILLING_LIMIT * DEFAULT_ALERT_FRACTION),
  },
  accounts: {},
};

function positiveNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse the stored JSON, tolerating junk — a bad row must not disable alerts. */
export function parseThresholdConfig(raw: string | null | undefined): ThresholdConfig {
  if (!raw) return DEFAULT_THRESHOLD_CONFIG;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_THRESHOLD_CONFIG;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_THRESHOLD_CONFIG;
  const obj = parsed as { default?: unknown; accounts?: unknown };

  const def = (obj.default ?? {}) as Record<string, unknown>;
  const limit = positiveNumber(def.limit) ?? DEFAULT_BILLING_LIMIT;
  const alertAt = positiveNumber(def.alert_at) ?? Math.round(limit * DEFAULT_ALERT_FRACTION);

  const accounts: Record<string, Partial<ThresholdSetting>> = {};
  if (obj.accounts && typeof obj.accounts === "object") {
    for (const [id, value] of Object.entries(obj.accounts as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const entry: Partial<ThresholdSetting> = {};
      const l = positiveNumber(v.limit);
      const a = positiveNumber(v.alert_at);
      if (l !== null) entry.limit = l;
      if (a !== null) entry.alert_at = a;
      if (l !== null || a !== null) accounts[id] = entry;
    }
  }

  return { default: { limit, alert_at: alertAt }, accounts };
}

/**
 * The limit and alert level for one account. An account row may set only
 * the limit; the alert level then follows at 80% of it.
 */
export function resolveThreshold(config: ThresholdConfig, accountId: string): ThresholdSetting {
  const override = config.accounts[accountId] ?? {};
  const limit = override.limit ?? config.default.limit;
  const alertAt =
    override.alert_at ??
    (override.limit !== undefined
      ? Math.round(limit * DEFAULT_ALERT_FRACTION)
      : config.default.alert_at);
  // The warning must come before the limit, whatever was typed in.
  return { limit, alert_at: Math.min(alertAt, limit) };
}

/** A new config with one account's setting replaced. */
export function withAccountThreshold(
  config: ThresholdConfig,
  accountId: string,
  setting: ThresholdSetting
): ThresholdConfig {
  return {
    ...config,
    accounts: { ...config.accounts, [accountId]: { ...setting } },
  };
}

export type ThresholdStage = "approaching" | "reached";

const STAGE_RANK: Record<ThresholdStage, number> = { approaching: 1, reached: 2 };

export interface ThresholdStatus extends ThresholdSetting {
  /** Balance as a share of the limit, 0–100+ (can exceed 100 while a charge is pending). */
  pct: number;
  /** ₱ left before Meta charges the card; 0 when already there. */
  remaining: number;
  stage: ThresholdStage | null;
}

export function thresholdStatus(balance: number, setting: ThresholdSetting): ThresholdStatus {
  const { limit, alert_at } = setting;
  const stage: ThresholdStage | null =
    balance >= limit ? "reached" : balance >= alert_at ? "approaching" : null;
  return {
    limit,
    alert_at,
    pct: limit > 0 ? (balance / limit) * 100 : 0,
    remaining: Math.max(0, limit - balance),
    stage,
  };
}

// ─── Billing cycles ───

/**
 * Where the alert cron remembers the last balance it saw per account
 * (app_settings row, JSON). Meta does not say when it charged the card;
 * a balance lower than the one seen on the previous pass is how we know.
 */
export const BILLING_THRESHOLD_STATE_KEY = "fb_billing_threshold_state";

export interface ObservedBalance {
  /** Balance seen on the last pass, in ₱. */
  balance: number;
  /** Increments every time the balance drops: a charge or an early payment. */
  cycle: number;
}

export type ThresholdState = Record<string, ObservedBalance>;

/** Parse the stored state, tolerating junk — a bad row only restarts counting. */
export function parseThresholdState(raw: string | null | undefined): ThresholdState {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const state: ThresholdState = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    if (typeof v.balance !== "number" || !Number.isFinite(v.balance)) continue;
    const cycle = typeof v.cycle === "number" && Number.isInteger(v.cycle) && v.cycle >= 0 ? v.cycle : 0;
    state[id] = { balance: v.balance, cycle };
  }
  return state;
}

/**
 * The account's cycle after this pass. Every pass records the balance,
 * including passes where nothing alerts, so a charge is noticed even when
 * the balance is already climbing again by the time an alert is due.
 */
export function advanceCycle(prev: ObservedBalance | undefined, balance: number): ObservedBalance {
  if (!prev) return { balance, cycle: 0 };
  return { balance, cycle: balance < prev.balance ? prev.cycle + 1 : prev.cycle };
}

/** What the previous alert for this account recorded, from its payload. */
export interface PriorThresholdAlert {
  stage: ThresholdStage;
  cycle: number;
}

/**
 * Whether to raise an alert now.
 *
 * One alert per stage per billing cycle. In a new cycle the account is
 * warned again from the start; within a cycle, only a move to a later
 * stage (approaching → reached) raises a second alert.
 */
export function shouldAlert(
  status: ThresholdStatus,
  cycle: number,
  prior: PriorThresholdAlert | null
): boolean {
  if (!status.stage) return false;
  if (!prior) return true;
  if (prior.cycle !== cycle) return true;
  return STAGE_RANK[status.stage] > STAGE_RANK[prior.stage];
}

// ─── Failed payment ───

/**
 * How often a failed-payment alert repeats while the account stays unpaid.
 * Ads are stopped (or about to be) for as long as this lasts, so one email
 * is not enough.
 */
export const PAYMENT_FAILED_REPEAT_HOURS = 6;

const peso = (n: number) =>
  `₱${Math.round(n).toLocaleString("en-PH")}`;

export interface ThresholdAlertText {
  title: string;
  body: string;
}

/**
 * The words for the alert and email. Titles start with URGENT so the
 * subject line (🚨 + title) reads as one at a glance.
 */
export function describeThresholdAlert(args: {
  accountName: string;
  balance: number;
  status: ThresholdStatus;
  card: string | null;
  stores: string[];
}): ThresholdAlertText {
  const { accountName, balance, status, card, stores } = args;
  const storeText = stores.length > 0 ? ` (${stores.join(", ")})` : "";
  const cardText = card ? `the card on file (${card})` : "the card on file";

  if (status.stage === "reached") {
    return {
      title: `URGENT: ${accountName} hit its ${peso(status.limit)} billing limit — balance ${peso(balance)}`,
      body:
        `${accountName}${storeText} has reached its payment threshold, so Meta is charging ${cardText} now. ` +
        `If the charge fails, every ad in this account stops. Make sure the card can cover ${peso(balance)}, ` +
        `then check Ads Billing to confirm the account is still delivering.`,
    };
  }

  return {
    title: `URGENT: ${accountName} is at ${peso(balance)} of its ${peso(status.limit)} billing limit`,
    body:
      `${accountName}${storeText} is ${peso(status.remaining)} away from the ${peso(status.limit)} threshold. ` +
      `When the balance gets there, Meta charges ${cardText} for the full amount, and a failed charge stops every ad in the account. ` +
      `Fund the card now, or pay the balance early from Ads Billing.`,
  };
}

/**
 * The words for the failed-payment alert. `headline` and `action` come
 * from describeAccountStatus, so the email says the same thing as the
 * Ads Billing card.
 */
export function describePaymentFailedAlert(args: {
  accountName: string;
  balance: number;
  headline: string;
  action: string | null;
  card: string | null;
  stores: string[];
}): ThresholdAlertText {
  const { accountName, balance, headline, action, card, stores } = args;
  const storeText = stores.length > 0 ? ` Stores advertising here: ${stores.join(", ")}.` : "";
  const cardText = card ? ` Card on file: ${card}.` : "";
  const actionText = action ? ` ${action}` : "";
  return {
    title: `URGENT: ${accountName} payment failed — ${peso(balance)} unpaid`,
    body:
      `${headline}${storeText}${cardText}${actionText} ` +
      `This alert repeats every ${PAYMENT_FAILED_REPEAT_HOURS} hours until the account is paid.`,
  };
}
