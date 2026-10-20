interface Props {
  label: string;
  value: string;
  subtitle?: string;
  /** Colors the subtitle: a delta or a note on the number. */
  tone?: "neutral" | "good" | "warn" | "bad";
  /** The tile needs attention right now: a danger edge, the number in red. */
  hot?: boolean;
  loading: boolean;
  /** Kept for the pages still passing icons; the tile no longer shows them. */
  icon?: React.ReactNode;
  iconBg?: string;
  accentBorder?: string;
  subtitleColor?: string;
}

const tones = {
  neutral: "text-muted",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
};

/**
 * A stat tile: a label, a number, and one line under it. No icon chips, no
 * tinted borders. Only `hot` colors the tile, so it still means something.
 */
/** The old props carried meaning in class names; keep that meaning. */
function legacyTone(color?: string): Props["tone"] | undefined {
  if (!color) return undefined;
  if (/green|emerald/.test(color)) return "good";
  if (/yellow|amber|orange/.test(color)) return "warn";
  if (/red/.test(color)) return "bad";
  return undefined;
}

export function StatCard({
  label,
  value,
  subtitle,
  tone: toneProp,
  hot: hotProp,
  loading,
  subtitleColor,
  accentBorder,
}: Props) {
  const tone = toneProp ?? legacyTone(subtitleColor) ?? "neutral";
  const hot = hotProp ?? /red/.test(accentBorder ?? "");
  return (
    <div
      className={`min-w-0 rounded-panel border bg-panel px-4 py-3 shadow-card ${
        hot ? "border-bad" : "border-line"
      }`}
    >
      <p className="text-label text-muted">{label}</p>
      {loading ? (
        <div className="mt-1.5 h-7 w-20 animate-pulse rounded-control bg-raised" />
      ) : (
        <>
          <p className={`mt-0.5 font-num text-2xl tracking-tight ${hot ? "text-bad" : "text-fg"}`}>
            {value}
          </p>
          {subtitle && (
            <p className={`mt-0.5 text-xs ${tones[tone]}`}>{subtitle}</p>
          )}
        </>
      )}
    </div>
  );
}
