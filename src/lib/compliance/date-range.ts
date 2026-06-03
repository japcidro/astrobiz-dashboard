// Date-range helper for the Compliance tab. Mirrors the PHT (+08:00) logic
// already used by /api/profit/daily so ad-spend and stock-movement extracts
// line up exactly with the P&L numbers the accountant reconciles against.

export type ComplianceDateFilter =
  | "this_month"
  | "last_month"
  | "last_7d"
  | "last_30d"
  | "this_year"
  | "custom";

export interface ComplianceRange {
  // YYYY-MM-DD strings in PHT — used for FB insights time_range + display.
  startDate: string;
  endDate: string;
  // ISO timestamps — used for Shopify orders created_at_min/max.
  createdAtMin: string;
  createdAtMax: string;
}

const PH_OFFSET = "+08:00";

function phDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function phStartOfDay(y: number, m: number, d: number): string {
  return `${phDateStr(y, m, d)}T00:00:00${PH_OFFSET}`;
}

function phEndOfDay(y: number, m: number, d: number): string {
  return `${phDateStr(y, m, d)}T23:59:59${PH_OFFSET}`;
}

export function computeComplianceRange(
  dateFilter: ComplianceDateFilter,
  dateFrom?: string | null,
  dateTo?: string | null
): ComplianceRange {
  const nowUtc = new Date();
  const phNow = new Date(nowUtc.getTime() + 8 * 60 * 60 * 1000);
  const phYear = phNow.getUTCFullYear();
  const phMonth = phNow.getUTCMonth();
  const phDate = phNow.getUTCDate();
  const todayStr = phDateStr(phYear, phMonth, phDate);

  switch (dateFilter) {
    case "this_month":
      return {
        startDate: phDateStr(phYear, phMonth, 1),
        endDate: todayStr,
        createdAtMin: phStartOfDay(phYear, phMonth, 1),
        createdAtMax: nowUtc.toISOString(),
      };

    case "last_month": {
      const firstOfThisMonth = new Date(Date.UTC(phYear, phMonth, 1));
      const lastMonth = new Date(firstOfThisMonth.getTime() - 1);
      const lmYear = lastMonth.getUTCFullYear();
      const lmMonth = lastMonth.getUTCMonth();
      const lmLastDay = lastMonth.getUTCDate();
      return {
        startDate: phDateStr(lmYear, lmMonth, 1),
        endDate: phDateStr(lmYear, lmMonth, lmLastDay),
        createdAtMin: phStartOfDay(lmYear, lmMonth, 1),
        createdAtMax: phEndOfDay(lmYear, lmMonth, lmLastDay),
      };
    }

    case "last_7d": {
      const d = new Date(phNow.getTime() - 6 * 24 * 60 * 60 * 1000);
      return {
        startDate: phDateStr(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        endDate: todayStr,
        createdAtMin: phStartOfDay(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        createdAtMax: nowUtc.toISOString(),
      };
    }

    case "last_30d": {
      const d = new Date(phNow.getTime() - 29 * 24 * 60 * 60 * 1000);
      return {
        startDate: phDateStr(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        endDate: todayStr,
        createdAtMin: phStartOfDay(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        createdAtMax: nowUtc.toISOString(),
      };
    }

    case "this_year":
      return {
        startDate: phDateStr(phYear, 0, 1),
        endDate: todayStr,
        createdAtMin: phStartOfDay(phYear, 0, 1),
        createdAtMax: nowUtc.toISOString(),
      };

    case "custom": {
      const from = dateFrom || todayStr;
      const to = dateTo || todayStr;
      const [fy, fm, fd] = from.split("-").map(Number);
      const [ty, tm, td] = to.split("-").map(Number);
      return {
        startDate: from,
        endDate: to,
        createdAtMin: phStartOfDay(fy, fm - 1, fd),
        createdAtMax: phEndOfDay(ty, tm - 1, td),
      };
    }

    default:
      return {
        startDate: phDateStr(phYear, phMonth, 1),
        endDate: todayStr,
        createdAtMin: phStartOfDay(phYear, phMonth, 1),
        createdAtMax: nowUtc.toISOString(),
      };
  }
}

// Convert an ISO timestamp to a PHT YYYY-MM-DD string.
export function toPhtDateStr(isoString: string): string {
  const d = new Date(isoString);
  const pht = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${pht.getUTCFullYear()}-${String(pht.getUTCMonth() + 1).padStart(2, "0")}-${String(pht.getUTCDate()).padStart(2, "0")}`;
}
